# -*- coding: utf-8 -*-
"""
🦅 Eagle 音频处理节点套件
重构版本，使用eagle_suite.utils 和 eagle_suite.logger
"""
import os
import subprocess
import torch
import numpy as np
import folder_paths
from .logger import logger
from .utils import get_cached_ffmpeg, ensure_dir


def _resolve_video_path(video):
    if video is None:
        return None
    if isinstance(video, str):
        return video if os.path.isfile(video) else None
    try:
        if hasattr(video, "get_stream_source"):
            source = video.get_stream_source()
            if isinstance(source, (str, os.PathLike)) and os.path.isfile(source):
                return str(source)
    except Exception:
        pass
    return None


class EagleAudioExtractor:
    """音频提取节点 - 从视频中提取音频"""
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "video_path": ("VIDEO",),
                "audio_codec": (["copy(原始流)", "aac", "mp3", "wav", "flac", "ogg", "m4a"], {
                    "default": "copy(原始流)"
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
    CATEGORY = "🦅 Eagle/音频"
    def extract_audio(self, video_path, audio_codec: str, audio_bitrate: str,
                       extract_audio: bool, output_dir: str = ""):
        """从视频提取音频"""
        video_path = _resolve_video_path(video_path)
        if not video_path:
            empty_audio = self._empty_audio()
            return (empty_audio, "", 0.0, 44100)
        ffmpeg = get_cached_ffmpeg()
        if not ffmpeg:
            empty_audio = self._empty_audio()
            return (empty_audio, "未找ffmpeg", 0.0, 44100)
        # 输出目录
        out_dir = output_dir.strip() if output_dir else folder_paths.get_output_directory()
        ensure_dir(out_dir)
        # 输出文件
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        extension_map = {
            "copy(原始流)": "mka",
            "aac": "m4a",
            "mp3": "mp3",
            "wav": "wav",
            "flac": "flac",
            "ogg": "ogg",
            "m4a": "m4a",
        }
        ext = extension_map.get(audio_codec, "m4a")
        output_path = os.path.join(out_dir, f"{base_name}_audio.{ext}")
        try:
            args = [ffmpeg, "-y", "-i", video_path]
            if extract_audio:
                if audio_codec == "copy(原始流)":
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
                if audio_codec != "copy(原始流)":
                    args += ["-ar", "44100"]
                args.append(output_path)
                result = subprocess.run(args, capture_output=True, timeout=300)
                if result.returncode != 0:
                    return (self._empty_audio(), 
                            f"音频提取失败: {result.stderr.decode('utf-8', errors='replace')[-200:]}",
                            0.0, 44100)
                waveform, sample_rate = self._read_audio(output_path)
                duration = waveform.shape[-1] / sample_rate if sample_rate > 0 else 0
                info = f"音频已提取 {output_path}\n⏱️ 时长: {duration:.2f}s\n🎵 采样率: {sample_rate}Hz"
                audio_data = {
                    "waveform": torch.from_numpy(waveform).float().unsqueeze(0),
                    "sample_rate": sample_rate,
                    "path": output_path
                }
                return (audio_data, info, duration, sample_rate)
            else:
                return (self._empty_audio(), f"📹 视频: {os.path.basename(video_path)}", 0.0, 0)
        except subprocess.TimeoutExpired:
            return (self._empty_audio(), "音频提取超时", 0.0, 44100)
        except Exception as e:
            return (self._empty_audio(), f"错误: {str(e)}", 0.0, 44100)
    def _read_audio(self, audio_path: str) -> tuple:
        """读取音频并统一返回 [channels, samples] float32。"""
        try:
            from comfy_extras.nodes_audio import load as comfy_load_audio
            waveform, sr = comfy_load_audio(audio_path)
            return waveform.detach().cpu().numpy().astype(np.float32, copy=False), sr
        except Exception:
            try:
                import soundfile as sf
                data, sr = sf.read(audio_path, always_2d=True, dtype="float32")
                return data.T, sr
            except Exception:
                from scipy.io import wavfile
                sr, data = wavfile.read(audio_path)
                if data.ndim == 1:
                    data = data[:, None]
                if np.issubdtype(data.dtype, np.integer):
                    scale = float(max(abs(np.iinfo(data.dtype).min), np.iinfo(data.dtype).max))
                    data = data.astype(np.float32) / scale
                else:
                    data = data.astype(np.float32, copy=False)
                return data.T, sr
    def _empty_audio(self):
        """返回空音频数"""
        return {
            "waveform": torch.zeros((1, 2, 44100), dtype=torch.float32),
            "sample_rate": 44100
        }
class EagleAudioMixer:
    """音频混音节点 - 混合多个音频"""
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
    CATEGORY = "🦅 Eagle/音频"
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
        audio_list = [
            self._resample_waveform(waveform, sample_rate, target_sr)
            for waveform, sample_rate in zip(audio_list, sample_rates)
        ]
        audio_list = self._match_batch_and_channels(audio_list)
        if mix_mode == "叠加混合":
            max_len = max(a.shape[-1] for a in audio_list)
            padded = []
            for a in audio_list:
                if a.shape[-1] < max_len:
                    pad_len = max_len - a.shape[-1]
                    a = np.pad(a, ((0, 0), (0, 0), (0, pad_len)), mode='constant')
                padded.append(a)
            mixed = np.sum(padded, axis=0)
            mixed = mixed / max(1.0, np.max(np.abs(mixed)) + 0.001)
        elif mix_mode == "交叉淡入淡出":
            mixed = audio_list[0]
            for following in audio_list[1:]:
                overlap = min(max(1, target_sr // 2), mixed.shape[-1], following.shape[-1])
                phase = np.linspace(0.0, np.pi / 2.0, overlap, dtype=np.float32)
                fade_out_curve = np.cos(phase)
                fade_in_curve = np.sin(phase)
                cross = (
                    mixed[..., -overlap:] * fade_out_curve
                    + following[..., :overlap] * fade_in_curve
                )
                mixed = np.concatenate(
                    [mixed[..., :-overlap], cross, following[..., overlap:]], axis=-1
                )
        else:
            max_len = sum(a.shape[-1] for a in audio_list)
            mixed = np.zeros((*audio_list[0].shape[:-1], max_len), dtype=np.float32)
            offset = 0
            for a in audio_list:
                mixed[..., offset:offset+a.shape[-1]] = a
                offset += a.shape[-1]
        # 淡入淡出
        if fade_in > 0:
            fade_samples = int(fade_in * target_sr)
            fade_curve = np.linspace(0, 1, min(fade_samples, mixed.shape[-1]))
            mixed[..., :len(fade_curve)] *= fade_curve
        if fade_out > 0:
            fade_samples = int(fade_out * target_sr)
            fade_curve = np.linspace(1, 0, min(fade_samples, mixed.shape[-1]))
            mixed[..., -len(fade_curve):] *= fade_curve
        result = torch.from_numpy(mixed).float()
        info = f"混音完成\n🎚模式: {mix_mode}\n⏱️ 时长: {mixed.shape[-1]/target_sr:.2f}s"
        audio_data = {
            "waveform": result,
            "sample_rate": target_sr
        }
        return (audio_data, info)
    def _get_waveform(self, audio) -> np.ndarray:
        if isinstance(audio, dict):
            waveform = audio.get("waveform")
            if isinstance(waveform, torch.Tensor):
                waveform = waveform.detach().cpu().numpy().copy()
            else:
                waveform = np.array(waveform, dtype=np.float32, copy=True)
        elif isinstance(audio, torch.Tensor):
            waveform = audio.detach().cpu().numpy().copy()
        else:
            waveform = np.array(audio, dtype=np.float32, copy=True)
        if waveform.ndim == 1:
            waveform = waveform[None, None, :]
        elif waveform.ndim == 2:
            waveform = waveform[None, :, :]
        elif waveform.ndim != 3:
            raise ValueError(f"不支持的音频维度: {waveform.shape}")
        return waveform.astype(np.float32, copy=False)

    def _resample_waveform(self, waveform: np.ndarray, source_sr: int, target_sr: int) -> np.ndarray:
        if source_sr == target_sr:
            return waveform
        if source_sr <= 0 or target_sr <= 0:
            raise ValueError("采样率必须大于 0")
        target_length = max(1, int(round(waveform.shape[-1] * target_sr / source_sr)))
        tensor = torch.from_numpy(waveform)
        return torch.nn.functional.interpolate(
            tensor, size=target_length, mode="linear", align_corners=False
        ).numpy()

    def _match_batch_and_channels(self, waveforms: list[np.ndarray]) -> list[np.ndarray]:
        target_batch = max(w.shape[0] for w in waveforms)
        target_channels = max(w.shape[1] for w in waveforms)
        matched = []
        for waveform in waveforms:
            if waveform.shape[0] not in (1, target_batch):
                raise ValueError("音频 batch 数量不兼容")
            if waveform.shape[0] == 1 and target_batch > 1:
                waveform = np.repeat(waveform, target_batch, axis=0)
            if waveform.shape[1] not in (1, target_channels):
                raise ValueError("音频声道数量不兼容")
            if waveform.shape[1] == 1 and target_channels > 1:
                waveform = np.repeat(waveform, target_channels, axis=1)
            matched.append(waveform)
        return matched
    def _get_sample_rate(self, audio) -> int:
        if isinstance(audio, dict):
            return audio.get("sample_rate", 44100)
        return 44100
    def _empty_audio(self):
        return {
            "waveform": torch.zeros((1, 2, 44100), dtype=torch.float32),
            "sample_rate": 44100
        }
