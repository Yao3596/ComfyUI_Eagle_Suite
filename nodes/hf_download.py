# -*- coding: utf-8 -*-
"""
EagleFileTools — HuggingFace 模型下载器
优化版：subprocess 替代 os.system，添加超时和错误处理
"""

import os
import subprocess


class EagleHFDownload:
    """从 HuggingFace 下载模型"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_full_name": ("STRING", {
                    "default": "",
                    "placeholder": "如 ByteDance/MegaTTS3"
                }),
                "save_path": ("STRING", {
                    "default": "",
                    "placeholder": "保存目录路径（留空使用 models/ 目录）"
                }),
            },
            "optional": {
                "token": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "HF Token（私有模型需要）"
                }),
                "timeout": ("INT", {"default": 600, "min": 60, "max": 86400}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("路径", "状态")
    OUTPUT_NODE = True
    FUNCTION = "download"
    CATEGORY = "🦅 Eagle/工具"

    def download(self, model_full_name, save_path, token="", timeout=600):
        if not model_full_name.strip():
            return ("", "❌ 请输入模型名称")

        # 确定保存路径
        if save_path.strip():
            dest = save_path.strip().rstrip("/\\")
        else:
            import folder_paths
            dest = os.path.join(folder_paths.models_dir, model_full_name.split("/")[-1])

        os.makedirs(dest, exist_ok=True)

        # 构建命令
        cmd = [
            "huggingface-cli", "download",
            "--resume-download",
            "--local-dir-use-symlinks", "False",
            model_full_name.strip(),
            "--local-dir", dest,
        ]
        if token:
            cmd.extend(["--token", token.strip()])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if result.returncode == 0:
                return (dest, f"✅ 下载完成: {os.path.basename(dest)}")
            else:
                err = result.stderr[:500] if result.stderr else "未知错误"
                return ("", f"❌ 下载失败: {err}")
        except subprocess.TimeoutExpired:
            return ("", f"❌ 下载超时（{timeout}秒），模型可能较大请增加超时时间")
        except FileNotFoundError:
            return ("", "❌ 未找到 huggingface-cli，请先安装: pip install huggingface_hub")
        except Exception as e:
            return ("", f"❌ 下载异常: {e}")
