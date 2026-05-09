"""
Eagle Suite - ComfyUI 节点套件
提供 Eagle 资源库集成、批量图像/视频处理等功能
"""

import sys
import subprocess
import importlib

def check_dependencies():
    """检查并自动安装依赖"""
    dependencies = {
        'imageio_ffmpeg': 'imageio-ffmpeg',  # 视频处理必需（注意包名用连字符）
        'cv2': 'opencv-python',              # 视频帧提取
        'requests': 'requests',              # Eagle API
    }
    
    missing = []
    for module_name, package_name in dependencies.items():
        try:
            importlib.import_module(module_name)
        except ImportError:
            missing.append((module_name, package_name))
    
    if missing:
        print("=" * 60)
        print("🦅 Eagle Suite: 检测到缺失依赖，正在自动安装...")
        print("=" * 60)
        
        for module_name, package_name in missing:
            print(f"📦 安装 {package_name}...")
            try:
                subprocess.check_call(
                    [sys.executable, "-m", "pip", "install", package_name],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE
                )
                print(f"✅ {package_name} 安装成功")
            except subprocess.CalledProcessError:
                print(f"⚠️ {package_name} 自动安装失败")
                print(f"   请手动运行: pip install {package_name}")
            except Exception as e:
                print(f"❌ 安装出错: {e}")
        
        print("=" * 60)
        print("✅ 依赖检查完成！如有失败请手动安装")
        print("=" * 60)

# 启动时检查依赖
check_dependencies()

# 导入节点
try:
    from .eagle_loader import EagleLoader
    from .eagle_saver import EagleSaver
    from .local_loader import LocalImageLoader
    from .batch_video_loader import EagleBatchVideoLoader, EagleVideoFrameExtractor, EagleVideoInfo
    from .video_nodes import EagleImagesToVideo, EagleVideoConverter
    from .api_model_loader import EagleAPIUnifiedNode
    from .api_key_node import EagleAPIKeyNode
    from .audio_nodes import EagleAudioExtractor, EagleAudioMixer
    
    print("✅ Eagle Suite 所有节点加载成功")
    
except ImportError as e:
    print("=" * 60)
    print(f"❌ Eagle Suite 节点加载失败: {e}")
    print("=" * 60)
    print("可能的原因：")
    print("1. 依赖未正确安装，请运行:")
    print("   pip install imageio-ffmpeg opencv-python requests")
    print("2. 节点文件缺失或损坏")
    print("3. Python 版本不兼容（需要 Python 3.8+）")
    print("=" * 60)
    raise

NODE_CLASS_MAPPINGS = {
    # ── Eagle 基础 ──
    "EagleLoader":              EagleLoader,
    "EagleSaver":               EagleSaver,
    "LocalImageLoader":         LocalImageLoader,

    # ── 视频处理 ──
    "EagleBatchVideoLoader":    EagleBatchVideoLoader,
    "EagleVideoFrameExtractor": EagleVideoFrameExtractor,
    "EagleVideoInfo":           EagleVideoInfo,
    "EagleImagesToVideo":       EagleImagesToVideo,
    "EagleVideoConverter":      EagleVideoConverter,

    # ── 音频处理 ──
    "EagleAudioExtractor":      EagleAudioExtractor,
    "EagleAudioMixer":          EagleAudioMixer,

    # ── API 工具 ──
    "EagleAPIUnifiedNode":      EagleAPIUnifiedNode,
    "EagleAPIKeyNode":          EagleAPIKeyNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # ── Eagle 基础 ──
    "EagleLoader":              "🦅 Eagle 图片加载",
    "EagleSaver":               "🦅 Eagle 图片保存",
    "LocalImageLoader":         "🦅 本地图片加载",

    # ── 视频处理 ──
    "EagleBatchVideoLoader":    "🦅 批量视频加载",
    "EagleVideoFrameExtractor": "🦅 视频帧提取",
    "EagleVideoInfo":           "🦅 视频信息",
    "EagleImagesToVideo":       "🦅 图像序列 → 视频",
    "EagleVideoConverter":      "🦅 视频格式转换",

    # ── 音频处理 ──
    "EagleAudioExtractor":      "🦅 音频提取",
    "EagleAudioMixer":          "🦅 音频混音",

    # ── API 工具 ──
    "EagleAPIUnifiedNode":      "🦅 API 多功能调用",
    "EagleAPIKeyNode":          "🦅 API Key Input",
}

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS']

# 打印加载信息
print("=" * 60)
print("🦅 Eagle Suite 已加载")
print(f"   📦 共 {len(NODE_CLASS_MAPPINGS)} 个节点")
print(f"   📂 基础功能: 3 | 视频处理: 5 | 音频处理: 2 | API工具: 2")
print("=" * 60)
