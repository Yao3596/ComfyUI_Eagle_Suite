# Eagle H3 导演台与制片流水线

## 职责边界

- **H3 导演台**：编辑世界设定、场景、镜头、台词和参考素材，编译为稳定的 `H3_CHAIN_PLAN` 与 `H3_MEDIA_BUNDLE`。
- **H3 标准媒体桥**：单一双向边界。既能把紧凑的 `media_bundle` 展开为 ComfyUI 标准 `IMAGE/AUDIO/STRING`，也能把第三方标准端口重新打包供参考条件路由消费。端口明确区分“参考图片”和“视频帧 IMAGE 批次”，不再把帧张量误标成原生 `VIDEO`。
- **H3 参考条件路由**：消费导演台 `media_bundle`，按当前场景启用的引用标签动态绑定官方 MiniMax H3 Ref2VA 独立槽位，并把上一镜末帧作为可选 Guide 注入。
- **H3 循环开始**：直接消费导演台 `plan`，合并预检、初始化、恢复与原生循环入口。
- **H3 制片流水线**：逐镜执行生成、承接上下文、落盘检查点、审片、恢复和合成，不反向修改导演台数据。

## 推荐执行逻辑

```text
H3 导演台.plan
  → H3 · 循环开始
       ├─ flow ───────────────────────────┐
       └─ state → 镜头与上下文 → 参考条件路由 → H3 生成 │
                                      → 分段保存与审片 → 循环结束与合成
                                                            ↑
                                                            └─ flow 必须直连
```

在“H3 导演台”的右键菜单选择“创建 H3 核心主链”，可一次建立并连接上述核心承接节点。也可以在任一核心节点上选择“添加后续节点”。生成模型、VAE 与采样/解码节点仍放在“镜头与上下文”和“分段保存与审片”之间，因为具体模型链不应被 Eagle 强行固化。

加载旧工作流时，前端会在每种核心节点都只有一个的前提下补齐缺失的原生数据线；它只填空端口，不覆盖用户已有连接。也可在任一 H3 核心节点右键选择“修复 H3 原生主链连接”。其中 `镜头与上下文.length → 参考条件路由.length` 是强制逐镜连接，两端均为真实 `INT` 端口；`prompt / width / height / length` 缺线会在执行前直接暴露，而不会静默使用 124 帧默认值。

## 参考素材连接

推荐只连接一条媒体总线：

```text
H3 导演台.media_bundle ──────────────┐
镜头与上下文.state / prompt ──────┼→ H3 · 参考条件路由 → positive / latent
镜头与上下文.context_image ─────────┤
上一镜 sampled AV latent ────────────┘  （运行期承接或从 .pt 检查点恢复）
CLIP / 视频 VAE / 音频 VAE ─────────┘
```

路由节点会按当前场景真正引用的标签筛选素材，并尊重导演台中的“忽略”状态。图片、视频及音频分别进入官方节点的 Autogrow 独立槽位，保持 `<Picture #>`、`<Video #>`、`<Audio #>` 的语义对应；若筛选后编号不连续，路由会同步压紧提示词编号。宫格只适合人眼预览，不应用作 H3 参考条件输入。

`ref_images` 和 `media_mapping` 都是 `media_bundle` 的内部数据：前者保留独立图片张量，后者维护稳定的素材标签与张量映射。标准媒体桥的 `first_reference_image` 是普通单张 `IMAGE`，可直接连接首镜 `seed_image`；它不是 ComfyUI 列表输出。`ref_video_0..2` 按官方 H3 的零基槽位命名，值是视频解码后的 `IMAGE` 帧批次，不是 ComfyUI 原生 `VIDEO` 对象；配对声音位于 `ref_video_audio_0..2`，独立参考音频位于 `ref_audio_0..2`。旧“媒体包展开 / 标准媒体输入 / 标准媒体输出”已从节点注册表移除，新工作流统一使用标准媒体桥。

## 端口互操作契约

| 数据 | 对外类型 | 原则 |
| --- | --- | --- |
| 计划 | `H3_CHAIN_PLAN` + `STRING(plan_json)` | 与 MiniMax H3 Context Loop 的后端计划契约一致；后端消费节点可直接连接。“计划 JSON 桥”负责通用文本/存储系统的双向转换和字段校验。第三方网页编辑器另有来源节点限制，按下方兼容链连接。 |
| Eagle 状态 | `EAGLE_H3_STATE` + `STRING(state_json)` | 内部状态保留强类型；“状态与上一片段”额外输出标准 `VIDEO`、计划、索引和 manifest 路径。JSON 重新接入时先验证版本和计划结构。 |
| 循环控制 | `EAGLE_H3_FLOW` | 这是 `rawLink + GraphBuilder` 的图控制边，不是业务数据。必须从 Eagle Loop Start 直连 Eagle Loop End，不开放为 `*` 或第三方 `H3_CHAIN_FLOW`。 |
| 媒体总线 | `H3_MEDIA_BUNDLE` ⇄ `IMAGE/AUDIO/STRING` | 总线只用于 Eagle 内部紧凑传输；两侧标准媒体节点是公开边界。第三方无需理解 bundle 字典。 |

ComfyUI 的联合类型只比较类型名集合，不验证 Python 字典字段。于是把 Eagle state 简单改名为 `H3_CHAIN_STATE` 虽然会显示“能连接”，执行时却会因为 `current_index/shots` 与 `index/previous_frames/previous_latent` 两套结构不同而崩溃。开放性的判断标准因此是“数据可无损转换”，而不是端口颜色相同。计划与标准媒体可以开放；递归 flow 和含检查点语义的 state 必须通过明确边界。

文本编辑不设置硬字符上限，也不做自动截断。编译预览保留字数统计，但字数本身不会使 Plan 预检失败。

导演台把参考配置拆成三层，不能再用一种“分类”同时承担全部含义：

1. **物理类型**决定连接到图片、视频或音频槽；
2. **主要用途**声明素材控制人物/物体/场景/风格/动作/运镜/剪辑节奏/首尾帧/音色等哪一项；
3. **保留策略**声明完全保留、部分保留、属性迁移、弱参考，或音频的完整复制、部分复制、参考、弱参考。

每个主体类素材会生成稳定的 `<Subject N>`，并在 `subject_definitions` 中通过对应物理标签声明来源，例如 `<Subject 1> ... defined by <Picture 1>`。这样提示词能表达“这是同一角色”，而参考条件路由仍可依照 `<Picture 1>` 找到真实张量。一个素材应只有一个清晰的主要职责；需要补充绑定对象或局部范围时填写“用途说明”。

音频不能单独作为 H3 参考输入，必须至少搭配一张参考图或一段参考视频。普通参考视频的音轨不会自动进入 `<Audio N>`；只有在素材卡中显式勾选“启用该视频原声为音频参考”时，才向官方节点发送同编号视频原声，并相应校正后续独立音频编号。

官方 Ref2VA 单次最多接收 9 张参考图、3 段参考视频和 3 段独立参考音频。路由会按导演台顺序保留上限内素材，并在 `active_references` 报告中把超出的条目标记为 `official_slot_limit`；需要更多素材时应按场景分配，而不是全部同时启用。

导演台预检还会阻止混合参考总数超过 12、音频单独输入、槽位越界和非法裁剪区间；未填写“用途说明”会给出警告但不会阻塞简单项目。R2V/RV2V/V2V 使用 `subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music` 六字段；T2VA/I2VA/FL2VA/L2VA 使用 `integrated_multimodal_description → overall_soundscape → non_diegetic_music` 三字段。首/尾帧对齐说明位于三字段之前，不再混入 Ref2VA 字段。

参考图尺寸可在一个列表中选择：`match` 跟随生成画布面积，`1.2 · 768px` 至 `3.1 · 1984px` 在倍率后直接显示对应短边上限，`max` 映射官方 `2048px` 上限。数值档位以 640px 为基准按 0.1 递增，只做等比缩小，不放大小图；旧工作流里的纯倍率字符串仍可解析。

导演 Skill 批量生成与视频生成是两个明确阶段。Skill 请求执行时，导演台返回静默 `ExecutionBlocker`，不会让同一队列继续进入参考条件、采样或保存节点；全部场景完成后按设置释放本地 LLM，并自动提交一次不含 Skill 请求的完整 Plan 队列，再进入视频循环。

`auto` 模式下，原生 End 使用 ComfyUI `GraphBuilder.expand` 在**同一次执行**中克隆 Start 与 End 之间的子图，将新 `state` 注入下一轮。最后一镜通过后自动合成。

`interactive` 模式下，每镜仍然单独停在审片点；审批后再执行下一镜，避免上一镜的决定被重用到后续镜头。

## 合并原则

| 现在显示的节点 | 内置职责 | 不再单独显示的旧实现 |
| --- | --- | --- |
| H3 · 循环开始 | Plan 预检、初始化/恢复、原生循环入口、尺寸/FPS | 计划、预检、载入清单、旧开始 |
| H3 · 镜头与上下文 | 当前镜头参数、首图/上一镜上下文 | 当前镜头、上下文 |
| H3 · 重叠帧与音频裁剪 | 移除续镜重复首帧、音画同步、保留可选融合帧 | 旧视频时间裁剪不再承担续镜重叠处理 |
| H3 · 分段保存与审片 | 接收帧或现成视频、分段落盘、检查点、审批/重试/停机 | 分段检查点、审片门 |
| H3 · 循环结束与合成 | 推进、原生递归、最终拼接、本地 + Eagle 双目标保存 | 旧结束、合成、推进+合成 |

## 审片、版本与恢复闭环

紧凑主链只合并界面，不再合并或省略数据语义。每次生成的单镜保存为 `shots/shot_NN/clip_r0001.mp4`、`clip_r0002.mp4`…，同时写入提示词侧车和 JSON 检查点；新版本只更新 manifest 的 active revision，不删除旧文件。H3 主工作流必须把同一个采样器 `output` 同时连接到解码器、`分段保存与审片.sampled_latent` 和 `循环结束与合成.sampled_latent`。检查点只保存其中的视频/音频双流并移到 CPU；循环结束只承接必要尾帧和这两路 AV latent，不保留完整解码视频或采样附加数据。

`interactive` 审片支持：

- 批准并继续；
- 修改当前镜提示词、种子、H3 `17k+5` 原始帧长后重试；
- 自动换种子重抽；
- 从历史场景重做，仅保留它之前的已批准活动版本；
- 批准当前镜并停止，可选立即合成部分成片。

`循环结束与合成` 接收裁剪后的 `images` 与采样器原始 `sampled_latent`，并输出强类型 `EAGLE_H3_MANIFEST`、`partial`、`last_context_frames` 和 `last_context_latent`。默认仍保持“结束时自动合成”；需要像传统制片链那样分开终止与交付时，关闭 `auto_assemble`，把 `manifest` 接入独立的 `H3 · 最终装配（Manifest）`。装配只采用已批准 active revision，不会把已拒绝或等待重试的镜头混入成片。

生成页把两类语言分开管理：`画面提示词模板` 默认 English，以获得较稳定的镜头、动作和运镜语法；`台词文本语言` 默认 Chinese。发声者在标签外稳定编号为 `(S1)/(S2)`，台词写为 `<d>[Chinese] 原文</d>`。运镜使用 `Push In / Pan Right / Arc Shot / Tracking Shot` 等自然语言，必要时补幅度与速度，不再堆叠方括号命令。

第三方 Scene Prompt Editor 的浏览器界面会沿输入链硬编码查找类名 `MiniMaxH3ChainPlan`，然后直接读写该节点的 `plan_json` 和 `run_name` 控件。因此这不是端口颜色或 `H3_CHAIN_PLAN` 后端类型错误，而是第三方编辑器额外限定了“编辑源节点”。要让第三方编辑预览正常工作，必须保留它自己的 Plan 节点：

```text
H3 导演台内部状态
  ⇢（Eagle 前端镜像初始值）MiniMax H3 Context Loop Plan.plan_json 控件
  → MiniMax H3 Scene Prompt Editor.plan
  → 第三方 Loop Start.plan
```

在导演台右键选择“创建 Context Loop 兼容编辑链”可自动创建前两个第三方节点并完成连接；旧图中若把 `H3 导演台.plan` 直接接到了第三方编辑器，或曾用 Eagle 状态桥误接 JSON，加载工作流时会在“唯一导演台 + 唯一编辑器”的明确条件下自动补建真实 Plan 节点、同步导演台镜像、改接编辑器，并把编辑后的 `plan` 送入唯一第三方 Loop Start。手动右键命令“修复 Context Loop 编辑预览链”可随时重做这项检查。

`context_loop_plan_json` 端口仍保留给无界面队列、文本预览和外部存储。不建议在可编辑链中长期连到第三方 `plan_json_input`：该输入是强制覆盖，会让 Scene Prompt Editor 写回 `plan_json` 的修改在执行时失效。修复器会仅断开“导演台 JSON 直接覆盖该 Plan”的旧线，不动用户连入的其他外部数据源。

两套循环从 Start 开始必须完整二选一，不能交叉接 state/flow：

| 链路 | Plan | State | Flow | 当前镜头节点 |
| --- | --- | --- | --- | --- |
| Eagle 原生 | `H3_CHAIN_PLAN` | `EAGLE_H3_STATE` | `EAGLE_H3_FLOW` | `EagleH3ShotContextNode` |
| MiniMax Context Loop | `H3_CHAIN_PLAN` | `H3_CHAIN_STATE` | `H3_CHAIN_FLOW` | `MiniMaxH3ChainCurrent` |

`H3_CHAIN_PLAN` 是双方共有的静态计划；`state` 包含各自的递归、张量与检查点状态，不能无损互转。若需要在两套循环之间交换结果，应在循环边界使用标准 `IMAGE / AUDIO / VIDEO / STRING`，而不是让端口标签伪装成同一种 state。

“参考条件路由”是一个受控例外：它只读取 `state.plan` 与当前镜头索引，不接管递归或检查点，因此其 `state` 输入显式接受 `EAGLE_H3_STATE,H3_CHAIN_STATE`。使用第三方循环时，应让 Current Shot 一次提供同一镜头的全部动态字段：

```text
MiniMax H3 Context Loop Current Shot
  ├─ state  → 参考条件路由.state
  ├─ prompt → 参考条件路由.prompt
  ├─ length → 参考条件路由.length
  ├─ width  → 参考条件路由.width
  └─ height → 参考条件路由.height
```

这不等于把第三方 state 转成 Eagle state；路由只兼容其只读镜头视图。右键“参考条件路由”选择“接入 Context Loop Current Shot 数据”可一次完成这五条连接。若参考路由的 `positive` 已直连第三方 `MiniMaxH3ChainContext`，加载工作流时也会自动识别并修正旧的固定 `length=124`、空 prompt 及错误 state 来源。

续镜重叠属于帧级数据契约，不能用端口颜色或普通 `VIDEO` 时间裁剪代替。标准接法为：`参考条件路由.trim_frames → 重叠帧与音频裁剪.trim_frames`，VAE 的 `IMAGE/AUDIO` 接入同一裁剪节点，再把裁剪输出直接接到“分段保存与审片”。`trim_frames` 来自底层 Motion Context 的实际编码结果，因此会正确处理 `head/before` 锚点差异。分段审片节点仍保留可选 `VIDEO` 输入，用于接收已有成片，但新工作流优先采用帧级路径。

旧类只作为组合节点的内部实现，不再注册到 ComfyUI 节点菜单；本版本不保留旧工作流的可见兼容节点。

导演台前六个输出与 Context Loop Plan 顺序一致：`plan / summary / clip_count / width / height / video_blend_frames`。`plan` 继续使用共享的 `H3_CHAIN_PLAN`；Eagle 运行状态明确为 `EAGLE_H3_STATE`，因为它的索引、审片版本、落盘 manifest 与恢复语义不同于第三方 `H3_CHAIN_STATE`。自动递归期间它也会私有携带 `previous_frames / previous_latent`，但这两项不会写入 JSON；交互重启时由 `state.shots` 中的上一镜视频与 `.pt` 检查点恢复。

## 预检策略

预检报告带 `h3-prompt-spec@1.0` 和可定位的规则编号。其中 `H3-E005` 检查切镜时间严格递增，`H3-E006` 检查 4–15 秒生成区间，`H3-E011–013` 检查字段缺失、顺序和模式混用。这些数据完整性错误始终在采样前阻断；字符数不再作为阻断条件。

- `警告`（默认）：无效文本标签写入报告，其他流程可继续。
- `严格阻止`：无效标签变为错误，`H3 链·计划` 拒绝启动。
- `关闭`：不检查文本标签；端口数量、裁剪区间和 H3 帧格式仍是强制检查。

`plan_hash` 在原生递归期间会再次校验。若运行中修改了导演台计划，本轮会显式失败，不会将两个版本的镜头混入同一 manifest。

## 时间基准与区间

导演台把剪辑时间与 H3 生成时间分成两套明确字段：

- 剪辑时间使用 `MM:SS.mmm`（超过一小时可用 `HH:MM:SS.mmm`），镜头区间显示为 `start → end`。
- 帧区间统一为半开区间 `[start_frame, end_frame_exclusive)`；帧数等于两者之差，不存在首尾帧重复计数。
- 自动分配先按项目 FPS 计算整数帧边界，再反算时间码；最后一镜出点严格等于场景时长。
- `duration_seconds` / `timeline_duration_seconds` 是用户请求的剪辑预算，`timeline_frames` 是剪辑帧数。
- `raw_frames` 必须满足 H3 的 `17k+5`，续镜时还要包含头部上下文；`generated_duration_seconds = raw_frames / fps`。它只描述模型实际生成长度，不能反向改写剪辑时间。
- 解码后先按实际 `trim_frames` 移除头部上下文，再按 `delivered_frames → target_frames` 裁掉网格尾帧，因此 10.000 秒在 24fps 下精确交付 240 帧，即使 H3 首段实际生成 243 帧。
- `shot_timeline` 保存场景内部每镜的起止时间码、秒数和帧区间，便于审片、导出与外部工具无歧义回读。

最终 H3 提示词仍遵循官方语法：`[Shot 1]` 不写起始时间，后续镜头使用 `[Shot N] At MM:SS.mmm, ...`。编辑界面额外显示完整区间与帧数，但不会把工程元数据混入官方切镜语法。

## 尺寸与显存基准

16:9 预设以下表为唯一标准，9:16 直接交换宽高。所有尺寸均为 32 的倍数：

`0.2 608×352` · `0.3 736×416` · `0.4 864×480` · `0.5 960×544` · `0.6 1056×608` · `0.7 1152×640` · `0.8 1216×672` · `0.9 1280×736` · `0.98 1344×768` · `1.0 1376×768` · `1.2 1504×832` · `1.5 1664×928` · `1.8 1824×1024` · `2.0 1920×1088`。

自定义宽高会对齐到 32；锁链开启时修改单边会等比重算另一边，解锁后可独立设置。导演台在 Queue 前强制刷新状态，后端也会从旧工作流的 `sizePreset` 解析宽高，避免界面显示 960×544 而实际回退到 1056×1920。

附带的 16GB 工作流在 Sigma Shift 后启用 `MiniMaxChunkFeedForward(chunks=4, seq_threshold=4096)`，用于降低 H3 MLP/int8 linear 的峰值临时显存。预检以 `960×544×124帧` 为保守基线给出负载警告；警告不会阻断执行。

`H3 Motion Context` 会为续镜内部锚点接管 `PackedLayout`。`SolAttnPatch` 的 `Morton` 或 H3 `sink_conditioning` 也会包装同一构造器，两者同时开启会在采样前显式冲突。Eagle 续镜模板保留 Sol-Attn 稀疏注意力，但将 `sink_conditioning=off` 且 `morton=false`，由 Motion Context 唯一拥有布局补丁。首镜的单张 `seed_image` 只是起始图，不再误入 Motion Context。

## 角色 PV 创意抽卡与文字

“H3 · PV 创意抽卡”与导演台内嵌的“AI 创意抽卡”共用同一数据合同：主题、视觉风格、切镜语法、动作画像、节奏、转场、特效和文字后期方案。未连接语言模型时由受控创意库按角色描述匹配；连接本地模型或 API 后，模型只在合法候选中择优并补全动作方向。抽卡历史与场景生成历史分别保留最近 50/40 条摘要，用于避免重复动作弧、景别顺序和转场组合，而不是无限堆积完整提示词。

角色 PV 不再强制固定五段式。Hook / Reveal / Signature / Impact / Hero Hold 仅作为可选镜头词汇，最终段落数量和顺序由主题、切镜语法、角色动作、素材、时长与节拍共同决定。

H3 可以偶然生成类似文字的纹理，但不能可靠保证拼写、字体、字距和跨帧稳定。导演台因此只要求模型预留 title-safe 区域，并把主标题、副标题及 `text_treatment` 写入 `post_production.text_overlays`；精确可读文字应由后期合成节点添加。`generation_can_render_exact_text=false` 是显式能力标记。

## Obsidian 导出契约

导演技能库 Markdown 使用 `eagle-director-skills/v2`。导出内容符合知识库的 Obsidian 规范：标准 `title/type/tags/created/updated` Properties、唯一一级标题、二级“技能库”章节，以及每项技能的三级标题。技能正文原有的一至三级标题会自动降到四至六级，避免破坏文档层级；`eagle-skill-meta` JSON 与区块注释继续作为稳定的机器回读边界，旧版区块仍可导入。

## 参考实现的取舍

- Bernini 的精确时间线、分段指纹和可恢复检查点：Eagle 保留 plan hash、镜头稳定 seed、manifest 与上下文缓存。
- Goohai 的稳定素材槽、标签与裁剪状态：Eagle 使用版本化导演台状态和预检策略，不把素材数据复制到流水线节点。
- Context Loop 的 `rawLink + DYNPROMPT + GraphBuilder`：Eagle 将它作为新原生循环语义，但用 `EAGLE_H3_STATE` 明确隔离 Eagle 落盘清单与第三方张量状态。
