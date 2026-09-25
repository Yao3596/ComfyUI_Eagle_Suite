[CmdletBinding()]
param(
    [switch]$Apply,
    [Alias('WorkRoot')]
    [string]$RepositoryRoot,
    [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'

function Resolve-DeploymentRoot([string]$Path, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Label 不能为空。"
    }
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($item.PSProvider.Name -ne 'FileSystem' -or -not $item.PSIsContainer) {
        throw "$Label 必须是已存在的文件系统目录：$Path"
    }
    $fullPath = [System.IO.Path]::GetFullPath($item.FullName)
    $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Equals($pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label 不能是文件系统根目录：$fullPath"
    }
    return $fullPath.TrimEnd([char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-RootContains([string]$Root, [string]$Candidate) {
    $prefix = $Root + [System.IO.Path]::DirectorySeparatorChar
    return $Candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $RepositoryRoot = Join-Path $PSScriptRoot '..'
}
if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    throw '必须通过 -TargetRoot 显式指定已存在的 ComfyUI_Eagle_Suite 目标目录。'
}

$workRoot = Resolve-DeploymentRoot $RepositoryRoot '仓库根目录'
$liveRoot = Resolve-DeploymentRoot $TargetRoot '部署目标根目录'
if ($workRoot.Equals($liveRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Test-RootContains $workRoot $liveRoot) -or
    (Test-RootContains $liveRoot $workRoot)) {
    throw '仓库根目录和部署目标根目录必须是两个不重叠的目录。'
}

function Test-ConnectionRefused([System.Management.Automation.ErrorRecord]$ErrorRecord) {
    $exception = $ErrorRecord.Exception
    while ($null -ne $exception) {
        if ($exception -is [System.Net.Sockets.SocketException] -and
            $exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::ConnectionRefused) {
            return $true
        }
        $exception = $exception.InnerException
    }
    return $false
}

function Assert-ComfyQueueSafe {
    try {
        $queueState = Invoke-RestMethod -Uri 'http://127.0.0.1:8189/queue' -TimeoutSec 5
    } catch {
        if (Test-ConnectionRefused $_) {
            Write-Host 'ComfyUI 未运行（连接被拒绝）；按离线安全状态继续。'
            return $false
        }
        throw
    }
    if ($queueState.queue_running.Count -gt 0 -or $queueState.queue_pending.Count -gt 0) {
        throw 'ComfyUI 队列不为空；不覆盖在线插件。'
    }
    return $true
}

$relativeFiles = @(
    'eagle_suite\__init__.py',
    'eagle_suite\advanced_video_saver.py',
    'eagle_suite\danbooru_library.py',
    'eagle_suite\danbooru_search.py',
    'eagle_suite\eagle_gallery.py',
    'eagle_suite\h3_director_node.py',
    'eagle_suite\h3_pipeline\media_utils.py',
    'eagle_suite\h3_pipeline\nodes.py',
    'eagle_suite\h3_pipeline\refinement.py',
    'eagle_suite\h3_pipeline\review_runtime.py',
    'eagle_suite\h3_pipeline\routes.py',
    'eagle_suite\h3_pipeline\state.py',
    'eagle_suite\h3_review_workspace.py',
    'eagle_suite\local_llm_node.py',
    'eagle_suite\lora_gallery.py',
    'eagle_suite\media_timeline_editor.py',
    'eagle_suite\nodes.py',
    'eagle_suite\route_registry.py',
    'eagle_suite\svelte_character_interaction.py',
    'eagle_suite\svelte_character_pv.py',
    'eagle_suite\eagle_saver.py',
    'eagle_suite\text_nodes.py',
    'eagle_suite\text_switch_node.py',
    'eagle_suite\video_nodes.py',
    'nodes\prompt_presets.py',
    'web\js\api_key_input.js',
    'web\js\api_unified.js',
    'web\js\audio_browser.js',
    'web\js\danbooru_search_vue.js',
    'web\js\director_skill_node.js',
    'web\js\eagle_gallery.js',
    'web\js\eagle_saver_labels.js',
    'web\js\eagle_vue_theme.js',
    'web\js\h3_director.js',
    'web\js\h3_pipeline.js',
    'web\js\h3_review_workspace_svelte.js',
    'web\js\latent_switch_node.js',
    'web\js\local_llm_source_state.js',
    'web\js\lora_gallery.js',
    'web\js\media_timeline_editor.js',
    'web\js\prompt_presets.js',
    'web\js\prompt_variables_node.js',
    'web\js\svelte_character_interaction.js',
    'web\js\text_studio.js',
    'web\js\text_switch_node_vue.js',
    'web\js\unified_media_browser.js',
    'web\js\video_frame_extractor_vue.js',
    'web\js\video_saver.js',
    'web\js\wallhaven_gallery.js',
    'web\js\workflow_persistence.js',
    'web\js\workflow_secret_redaction.js'
)

$planned = @()
foreach ($relative in $relativeFiles) {
    $source = [System.IO.Path]::GetFullPath((Join-Path $workRoot $relative))
    $target = [System.IO.Path]::GetFullPath((Join-Path $liveRoot $relative))
    if (-not $source.StartsWith($workRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not $target.StartsWith($liveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "文件不在预期根目录内：$relative"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "缺少开发文件：$source"
    }
    $exists = Test-Path -LiteralPath $target -PathType Leaf
    if ($exists) {
        $sourceTime = (Get-Item -LiteralPath $source).LastWriteTimeUtc
        $targetTime = (Get-Item -LiteralPath $target).LastWriteTimeUtc
        if ($targetTime -gt $sourceTime) {
            throw "在线文件比开发副本更新，请先合并：$target"
        }
        if ((Get-FileHash -LiteralPath $source).Hash -eq
            (Get-FileHash -LiteralPath $target).Hash) {
            continue
        }
    }
    $planned += [pscustomobject]@{
        Relative = $relative
        Source = $source
        Target = $target
        TargetExists = $exists
        TargetHash = if ($exists) { (Get-FileHash -LiteralPath $target).Hash } else { $null }
        SourceHash = (Get-FileHash -LiteralPath $source).Hash
    }
}

"待更新运行文件：$($planned.Count) 项"
$planned | ForEach-Object { "  $($_.Relative)" }
if (-not $Apply -or $planned.Count -eq 0) { return }

$comfyWasOnline = Assert-ComfyQueueSafe

$backupRoot = Join-Path $workRoot ('deployment_backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($item in $planned) {
    if ($item.TargetExists) {
        $backup = Join-Path $backupRoot $item.Relative
        New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $item.Target -Destination $backup
    }
}

# ComfyUI may start (or a queue may begin) during backup.  Probe again
# immediately before touching the target tree.  A positive connection must still be idle;
# only an explicit connection-refused result is treated as safely offline.
$comfyIsOnline = Assert-ComfyQueueSafe
foreach ($item in $planned) {
    if ($item.TargetExists) {
        if (-not (Test-Path -LiteralPath $item.Target -PathType Leaf) -or
            (Get-FileHash -LiteralPath $item.Target).Hash -ne $item.TargetHash) {
            throw "在线文件在备份期间改变，请先合并：$($item.Target)"
        }
    } elseif (Test-Path -LiteralPath $item.Target) {
        throw "在线目录在备份期间新增同名文件，请先合并：$($item.Target)"
    }
}
foreach ($item in $planned) {
    if ((Get-FileHash -LiteralPath $item.Source).Hash -ne $item.SourceHash) {
        throw "开发文件在备份期间被修改，停止：$($item.Source)"
    }
    New-Item -ItemType Directory -Path (Split-Path $item.Target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $item.Source -Destination $item.Target -Force
    if ((Get-FileHash -LiteralPath $item.Target).Hash -ne $item.SourceHash) {
        throw "写入校验失败；备份位于 $backupRoot"
    }
}
"已更新 $($planned.Count) 项；逐文件备份：$backupRoot"
'需要重启 ComfyUI 并刷新浏览器，才能加载 Python/JS 变更；此脚本不会重启。'
