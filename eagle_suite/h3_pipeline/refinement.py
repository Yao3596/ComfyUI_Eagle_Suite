"""Canvas-safe handoff between H3 sampling stages (not a sampler replacement)."""

import torch
import torch.nn.functional as F


def _av_streams(value, label):
    if hasattr(value, "tensors"):
        parts = list(value.tensors)
    elif isinstance(value, (tuple, list)):
        parts = list(value)
    else:
        raise ValueError(f"{label} 必须是 H3 视频/音频双流，不能是单路视频 latent")
    if len(parts) != 2 or not all(torch.is_tensor(part) for part in parts):
        raise ValueError(f"{label} 必须包含两个张量")
    return parts


class EagleH3RefineHandoffNode:
    """Re-encode native guides at the upscale canvas and retain AV masks."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "positive": ("CONDITIONING",), "latent": ("LATENT",),
            "vae": ("VAE",), "source_latent": ("LATENT",),
        }}

    RETURN_TYPES = ("CONDITIONING", "LATENT", "STRING")
    RETURN_NAMES = ("positive", "latent", "summary")
    FUNCTION = "execute"
    CATEGORY = "🦅 Eagle Suite/H3 核心"
    DESCRIPTION = (
        "放在 latent 放大/AV 合并之后、第二采样之前。按目标画布重编码 H3 引导帧，"
        "保留参考素材和音频条件，并恢复 source_latent 的 AV 蒙版。"
        "source_latent 接前一采样器的 output（不是 denoised_output）。"
    )

    def execute(self, positive, latent, vae, source_latent):
        from comfy.nested_tensor import NestedTensor

        video, audio = _av_streams(latent.get("samples"), "latent")
        source_video, source_audio = _av_streams(source_latent.get("samples"), "source_latent")
        if video.ndim != 5 or audio.ndim != 4:
            raise ValueError("H3 需要 video[B,C,T,H,W] 与 audio[B,C,2,T]")
        if (video.shape[:3] != source_video.shape[:3]
                or audio.shape != source_audio.shape):
            raise ValueError("双采衔接只允许空间放大；不能改变批量、视频时长或音频时长")
        target_hw = tuple(video.shape[-2:])
        factor = int(vae.spacial_compression_encode())
        height, width = target_hw[0] * factor, target_hw[1] * factor
        reencoded = 0
        adapted = []
        memo = {}
        for tokens, metadata in positive:
            info = dict(metadata)
            guides = []
            for original in info.get("minimax_keyframes", []):
                guide = dict(original)
                z = guide.get("latent")
                if z is not None:
                    if not torch.is_tensor(z) or z.ndim != 5 or z.shape[0] != 1:
                        raise ValueError("H3 引导 latent 必须是单批次 [B,C,T,H,W]")
                    if tuple(z.shape[-2:]) != target_hw:
                        if id(z) not in memo:
                            # Latent interpolation is NOT a VAE-equivalent resize.
                            # Reconstruct pixels, then encode on the target grid.
                            frames = vae.decode(z)
                            if not torch.is_tensor(frames):
                                raise ValueError("H3 VAE 引导解码没有返回 IMAGE 帧")
                            # Video VAEs return [B,T,H,W,C], while ComfyUI's
                            # IMAGE contract consumed by ``vae.encode`` is
                            # [B*T,H,W,C].  The stock VAEDecode node performs
                            # the same flattening.  A single-frame/image VAE
                            # may already return the four-dimensional form.
                            if frames.ndim == 5:
                                if frames.shape[0] != z.shape[0]:
                                    raise ValueError("H3 VAE 引导解码的批次数与 latent 不一致")
                                frames = frames.reshape(
                                    -1, frames.shape[-3], frames.shape[-2], frames.shape[-1]
                                )
                            if frames.ndim != 4 or frames.shape[-1] < 3:
                                raise ValueError("H3 VAE 引导解码没有返回 IMAGE 帧")
                            frames = F.interpolate(
                                frames[..., :3].movedim(-1, 1), size=(height, width),
                                mode="bilinear", align_corners=False,
                            ).movedim(1, -1)
                            encoded = vae.encode(frames)
                            if encoded.shape[:3] != z.shape[:3] or tuple(encoded.shape[-2:]) != target_hw:
                                raise ValueError("H3 引导重编码改变了时间网格，停止二采以免错误续接")
                            memo[id(z)] = encoded
                            reencoded += 1
                        guide["latent"] = memo[id(z)]
                guides.append(guide)
            if "minimax_keyframes" in info:
                info["minimax_keyframes"] = guides
            # minimax_refs have their own canvas metadata: leave them intact.
            adapted.append([tokens, info])

        result = dict(latent)
        mask = source_latent.get("noise_mask")
        if mask is not None:
            vm, am = _av_streams(mask, "source noise_mask")
            if vm.ndim != 5 or am.ndim != 4:
                raise ValueError("H3 AV 蒙版维度无效")
            if vm.shape[2] not in (1, video.shape[2]) or am.shape[-1] not in (1, audio.shape[-1]):
                raise ValueError("H3 AV 蒙版的时间长度与采样不一致")
            vm = F.interpolate(vm.float(), size=(video.shape[2], *target_hw), mode="nearest")
            result["noise_mask"] = NestedTensor([vm, am])
        elif result.get("noise_mask") is not None:
            raise ValueError("目标 latent 带蒙版但 source_latent 没有；请检查双采蒙版来源")
        return adapted, result, f"二采 {width}×{height} · 重编码 {reencoded} 个引导 · AV 蒙版{'保留' if mask is not None else '无'}"
