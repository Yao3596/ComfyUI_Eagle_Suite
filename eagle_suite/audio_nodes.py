# -*- coding: utf-8 -*-
"""
🦅 Eagle 音频处理节点套件
重构版本，使用 eagle_suite.utils 和 eagle_suite.logger
"""

import os
import subprocess
import torch
import numpy as np
import folder_paths

from .logger import logger
from .utils import get_cached_ffmpeg, ensure_dir


class EagleAudioExtractor:
    """音频提取节点 - 从视频中提取音频流"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("STRING", {
                    "default": "",
                    "placeholder": "视频文件路径"
                }),
                "audio_codec": (["copy（原始流）", "aac", "mp3", "wav", "flac", "ogg", "m4a"], {
                    "default": "copy（原始流）"
                }),
                "audio_bitrate": (["64k", "128k", "192k", "256k", "320k", "lossless"], {
                    "default": "192k"
                }),
                "extract_audio": ("BOOLEAN", {"default": True, "tooltip": "是否提取音频"}),
            },
            "optional": {
                "output_dir": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING", "FLOAT", "INT")
    RETURN_NAMES = ("audio", "info", "duration", "sample_rate")
    OUTPUT_NODE = True
    FUNCTION = "extract_audio"
    CATEGORY = "🦅 Eagle/音频处理"

    def extract_audio(self, video_path: str, audio_codec: str, audio_bitrate: str,
                      extract_audio: bool, output_dir: str = ""):
        """从视频提取音频"""

        if not video_path or not os.path.exists(video_path):
            empty_audio = self._empty_audio()
            return (empty_audio, "❌ 视频文件不存在", 0.0, 44100)

        ffmpeg = get_cached_ffmpeg()
        if not ffmpeg:
            empty_audio = self._empty_audio()
            return (empty_audio, "❌ 未找到 ffmpeg", 0.0, 44100)

        # 输出目录
        out_dir = output_dir.strip() if output_dir else folder_paths.get_output_directory()
        ensure_dir(out_dir)

        # 输出文件名
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        ext = "wav" if audio_codec == "wav" else ("flac" if audio_codec == "flac" else "m4a")
        output_path = os.path.join(out_dir, f"{base_name}_audio.{ext}")

        try:
            args = [ffmpeg, "-y", "-i", video_path]

            if extract_audio:
                if audio_codec == "copy（原始流）":
                    args += ["-vn", "-c:a", "copy"]
                elif audio_codec == "wav":
                    args += ["-vn", "-c:a", "pcm_s16le"]
                elif audio_codec == "flac":
                    args += ["-vn", "-c:a", "flac"]
                elif audio_codec == "ogg":
                    args += ["-vn", "-c:a", "libvorbis", "-b:a", 
                             audio_bitrate if audio_bitrate != "lossless" else "192k"]
                elif audio_codec == "m4a":
                    args += ["-vn", "-c:a", "aac", "-b:a",
                             audio_bitrate if audio_bitrate != "lossless" else "192k"]
                else:
                    codec = "aac" if audio_codec == "aac" else "libmp3lame"
                    bitrate = "192k" if audio_bitrate == "lossless" else audio_bitrate
                    args += ["-vn", "-c:a", codec, "-b:a", bitrate]

                args += ["-ar", "44100", output_path]

                result = subprocess.run(args, capture_output=True, timeout=300)

                if result.returncode != 0:
                    return (self._empty_audio(), 
                            f"❌ 音频提取失败: {result.stderr.decode('utf-8', errors='replace')[-200:]}",
                            0.0, 44100)

                waveform, sample_rate = self._read_audio(output_path)
                duration = len(waveform) / sample_rate if sample_rate > 0 else 0

                info = f"✅ 音频已提取: {output_path}\n⏱️ 时长: {duration:.2f}s\n🎵 采样率: {sample_rate}Hz"

                audio_data = {
                    "waveform": torch.from_numpy(waveform).float(),
                    "sample_rate": sample_rate,
                    "path": output_path
                }
                return (audio_data, info, duration, sample_rate)
            else:
                return (self._empty_audio(), f"📹 视频: {os.path.basename(video_path)}", 0.0, 0)

        except subprocess.TimeoutExpired:
            return (self._empty_audio(), "❌ 音频提取超时", 0.0, 44100)
        except Exception as e:
            return (self._empty_audio(), f"❌ 错误: {str(e)}", 0.0, 44100)

    def _read_audio(self, audio_path: str) -> tuple:
        """读取音频文件"""
        try:
            import soundfile as sf
            data, sr = sf.read(audio_path)
            if data.ndim == 1:
                data = np.stack([data, data], axis=0)
            return data.T, sr
        except ImportError:
            try:
                from scipy.io import wavfile
                sr, data = wavfile.read(audio_path)
                if data.ndim == 1:
                    data = np.stack([data, data], axis=0)
                return data.T.astype(np.float32) / 32768.0, sr
            except Exception:
                return np.zeros((2, 44100), dtype=np.float32), 44100

    def _empty_audio(self):
        """返回空音频数据"""
        return {
            "waveform": torch.zeros((2, 44100), dtype=torch.float32),
            "sample_rate": 44100
        }


class EagleAudioMixer:
    """音频混音节点 - 混合多个音频流"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mix_mode": (["叠加混合", "交叉淡入淡出", "先A后B"], {"default": "叠加混合"}),
                "fade_in": ("FLOAT", {"default": 0.0, "min": 0, "max": 10.0, "step": 0.1}),
                "fade_out": ("FLOAT", {"default": 0.0, "min": 0, "max": 10.0}),
            },
            "optional": {
                "audio_a": ("AUDIO",),
                "audio_b": ("AUDIO",),
                "audio_c": ("AUDIO",),
                "volume_a": ("FLOAT", {"default": 1.0, "min": 0, "max": 2.0, "step": 0.1}),
                "volume_b": ("FLOAT", {"default": 1.0, "min": 0, "max": 2.0, "step": 0.1}),
                "volume_c": ("FLOAT", {"default": 1.0, "min": 0, "max": 2.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "info")
    FUNCTION = "mix_audio"
    CATEGORY = "🦅 Eagle/音频处理"

    def mix_audio(self, mix_mode: str, fade_in: float, fade_out: float,
                  audio_a=None, audio_b=None, audio_c=None,
                  volume_a: float = 1.0, volume_b: float = 1.0, volume_c: float = 1.0):
        """混音处理"""

        audio_list = []
        volumes = []
        sample_rates = []

        for audio, vol in [(audio_a, volume_a), (audio_b, volume_b), (audio_c, volume_c)]:
            if audio is not None:
                try:
                    waveform = self._get_waveform(audio)
                    sr = self._get_sample_rate(audio)
                    if waveform is not None and len(waveform) > 0:
                        audio_list.append(waveform * vol)
                        sample_rates.append(sr)
                        volumes.append(vol)
                except Exception:
                    continue

        if not audio_list:
            return (self._empty_audio(), "⚠️ 没有有效音频输入")

        target_sr = max(sample_rates) if sample_rates else 44100

        if mix_mode == "叠加混合":
            max_len = max(a.shape[-1] for a in audio_list)
            padded = []
            for a in audio_list:
                if a.shape[-1] < max_len:
                    pad_len = max_len - a.shape[-1]
                    a = np.pad(a, ((0, 0), (0, pad_len)), mode='constant')
                padded.append(a)
            mixed = np.sum(padded, axis=0)
            mixed = mixed / max(1.0, np.max(np.abs(mixed)) + 0.001)

        elif mix_mode == "交叉淡入淡出":
            if len(audio_list) >= 2:
                a, b = audio_list[0], audio_list[1]
                min_len = min(a.shape[-1], b.shape[-1])
                a, b = a[..., :min_len], b[..., :min_len]
                fade_len = min_len // 4
                fade_in_curve = np.linspace(0, 1, fade_len)
                fade_out_curve = np.linspace(1, 0, fade_len)
                for i in range(a.shape[0]):
                    a[i, -fade_len:] *= fade_out_curve
                    b[i, :fade_len] *= fade_in_curve
                mixed = a + b
            else:
                mixed = audio_list[0]

        else:
            max_len = sum(a.shape[-1] for a in audio_list)
            mixed = np.zeros((audio_list[0].shape[0], max_len))
            offset = 0
            for a in audio_list:
                mixed[:, offset:offset+a.shape[-1]] = a
                offset += a.shape[-1]

        # 淡入淡出
        if fade_in > 0:
            fade_samples = int(fade_in * target_sr)
            fade_curve = np.linspace(0, 1, min(fade_samples, mixed.shape[-1]))
            for i in range(mixed.shape[0]):
                mixed[i, :len(fade_curve)] *= fade_curve

        if fade_out > 0:
            fade_samples = int(fade_out * target_sr)
            fade_curve = np.linspace(1, 0, min(fade_samples, mixed.shape[-1]))
            for i in range(mixed.shape[0]):
                mixed[i, -len(fade_curve):] *= fade_curve

        result = torch.from_numpy(mixed).float()
        info = f"✅ 混音完成\n🎚️ 模式: {mix_mode}\n⏱️ 时长: {mixed.shape[-1]/target_sr:.2f}s"

        audio_data = {
            "waveform": result,
            "sample_rate": target_sr
        }
        return (audio_data, info)

    def _get_waveform(self, audio) -> np.ndarray:
        if isinstance(audio, dict):
            waveform = audio.get("waveform")
            if isinstance(waveform, torch.Tensor):
                return waveform.cpu().numpy()
            return np.array(waveform)
        elif isinstance(audio, torch.Tensor):
            return audio.cpu().numpy()
        return np.array(audio)

    def _get_sample_rate(self, audio) -> int:
        if isinstance(audio, dict):
            return audio.get("sample_rate", 44100)
        return 44100

    def _empty_audio(self):
        return {
            "waveform": torch.zeros((2, 44100), dtype=torch.float32),
            "sample_rate": 44100
        }


# 节点映射
NODE_CLASS_MAPPINGS = {
    "EagleAudioExtractor": EagleAudioExtractor,
    "EagleAudioMixer": EagleAudioMixer,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EagleAudioExtractor": "🦅 音频提取",
    "EagleAudioMixer": "🦅 音频混音",
}
