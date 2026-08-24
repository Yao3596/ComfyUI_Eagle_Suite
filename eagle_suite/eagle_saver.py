# -*- coding: utf-8 -*-
"""
Eagle 图片保存器 (重构版)
"""

import os
import tempfile
import time
import numpy as np
import torch
from PIL import Image

from .eagle_client import eagle_client
from .utils import generate_unique_filename, parse_tags
from .logger import logger

class EagleSaver:
    """Eagle 图片保存器 - 将 ComfyUI 图像保存到 Eagle 软件或本地"""

    # ✅ 类级别的全局计数器（用于纯 Eagle 保存场景）
    _global_counter = {}  # {folder_id: last_seq}

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "eagle_folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle 文件夹名称、路径或 ID"
                }),
            },
            "optional": {
                "local_save_path": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "留空则不保存到本地"
                }),
                "filename_prefix": ("STRING", {
                    "default": "ComfyUI",
                    "multiline": False,
                }),
                "filename_separator": ("STRING", {
                    "default": "_",
                    "multiline": False,
                    "placeholder": "文件名各部分之间的分隔符"
                }),
                "filename_number_padding": ("INT", {
                    "default": 4, "min": 0, "max": 10, "step": 1,
                    "tooltip": "文件名数字填充位数，0 表示不填充"
                }),
                "filename_number_start": ("INT", {
                    "default": 0, "min": 0, "max": 999999, "step": 1,
                    "tooltip": "起始编号"
                }),
                "file_extension": (["png", "jpg", "webp", "bmp"], {"default": "png"}),
                "dpi": ("INT", {
                    "default": 72, "min": 1, "max": 2400, "step": 1,
                }),
                "quality": ("INT", {
                    "default": 100, "min": 1, "max": 100, "step": 1,
                    "tooltip": "JPG/WebP 质量，PNG 忽略"
                }),
                "optimize_image": ("BOOLEAN", {"default": True}),
                "high_quality_webp": ("BOOLEAN", {"default": False}),
                "overwrite": ("BOOLEAN", {"default": False}),
                "save_metadata_in_png": ("BOOLEAN", {"default": True, "tooltip": "将 prompt/workflow 元数据嵌入 PNG 文件内部，与 ComfyUI 默认保存方式一致"}),
                "save_metadata_json": ("BOOLEAN", {"default": False, "tooltip": "额外输出同名 .png.json 元数据文件"}),
                "tags": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Eagle 标签：用逗号或换行分隔"
                }),
                "star": ("INT", {
                    "default": 0,
                    "min": 0, "max": 5, "step": 1,
                }),
                "annotation": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "placeholder": "Eagle 注释"
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("保存结果",)
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle"

    @classmethod
    def VALIDATE_INPUTS(cls, eagle_folder, local_save_path, filename_prefix, **kwargs):
        return True

    def save_images(self, images, eagle_folder, local_save_path="",
                    filename_prefix="ComfyUI", filename_separator="_",
                    filename_number_padding=4, filename_number_start=0,
                    file_extension="png", dpi=72, quality=100,
                    optimize_image=True, high_quality_webp=False, overwrite=False,
                    save_metadata_in_png=True, save_metadata_json=False,
                    tags="", star=0, annotation="",
                    prompt=None, extra_pnginfo=None):

        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())

        if not save_to_eagle and not save_to_local:
            return ("❌ 请至少指定 Eagle 文件夹或本地保存路径",)

        # 1. 解析 Eagle 文件夹 ID
        folder_id = None
        folder_correction = ""
        if save_to_eagle:
            value, itype = eagle_client.parse_folder_input(eagle_folder)
            if itype is None:
                return (f"❌ 无法解析 Eagle 文件夹输入: {eagle_folder}",)
            if itype == "eagle_id":
                folder_id, corrected = eagle_client.resolve_folder_id(value)
                if not folder_id:
                    return (f"❌ Eagle 文件夹 ID 不存在: {value}。请重新从 Eagle 文件夹地址复制 ID",)
                if corrected:
                    folder_correction = f"（文件夹 ID 已纠正: {value} → {folder_id}）"
            elif itype == "eagle_name":
                folder_id = eagle_client.find_folder_id_by_path(value)
                if not folder_id:
                    return (f"❌ 找不到 Eagle 文件夹: {value}",)
            elif itype == "local_path":
                logger.warning("检测到 Eagle 文件夹处填写了本地路径，已忽略 Eagle 保存")
                save_to_eagle = False

        tags_list = parse_tags(tags)
        success_count = 0
        local_count = 0
        temp_files = []
        eagle_errors = []
        temp_dir = tempfile.mkdtemp(prefix="eagle_suite_saver_") if save_to_eagle else ""

        # 2. 从 ComfyUI 工作流中提取元数据
        meta = self._build_metadata(prompt, extra_pnginfo)

        # ✅ 3. 统一确定起始序号：优先从本地目录扫描，其次使用 Eagle 全局计数器，最后使用用户设置
        seq = filename_number_start

        if save_to_local:
            os.makedirs(local_save_path, exist_ok=True)
            if not overwrite:
                # 扫描本地目录，找到最大编号
                try:
                    existing_files = [f for f in os.listdir(local_save_path) 
                                      if f.startswith(filename_prefix) and f.endswith(f".{file_extension}")]
                    max_num = -1
                    for fname in existing_files:
                        try:
                            # 提取编号：ComfyUI_0012.png → 12
                            after_prefix = fname[len(filename_prefix):]
                            if not after_prefix.startswith(filename_separator):
                                continue
                            num_part = after_prefix[len(filename_separator):]
                            num_part = num_part.rsplit(".", 1)[0]  # 移除扩展名
                            max_num = max(max_num, int(num_part))
                        except:
                            continue
                    if max_num >= 0:
                        seq = max_num + 1
                        logger.info(f"检测到本地已有文件，从编号 {seq} 开始")
                except Exception as e:
                    logger.warning(f"扫描本地文件失败: {e}")
        elif save_to_eagle and folder_id:
            # 纯 Eagle 保存场景：使用全局计数器
            counter_key = f"{folder_id}_{filename_prefix}_{filename_separator}_{file_extension}"
            if counter_key in EagleSaver._global_counter:
                cached_seq = EagleSaver._global_counter[counter_key]
                seq = max(seq, cached_seq + 1)
                logger.info(f"使用 Eagle 全局计数器，从编号 {seq} 开始")

        # 确保不小于用户设置的起始编号
        if seq < filename_number_start:
            seq = filename_number_start

        # ✅ 4. 处理每一张图片
        for idx, image in enumerate(images):
            try:
                # 张量转 PIL
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

                # 生成文件名（带序号控制）
                if filename_number_padding > 0:
                    seq_str = str(seq).zfill(filename_number_padding)
                else:
                    seq_str = str(seq)
                base_name = f"{filename_prefix}{filename_separator}{seq_str}"
                filename = f"{base_name}.{file_extension}"

                # A. 本地保存
                if save_to_local:
                    try:
                        full_path = os.path.join(local_save_path, filename)
                        # 二次兜底：如果因为并发等原因文件仍然存在，继续递增直到可用
                        if not overwrite and os.path.exists(full_path):
                            original_seq = seq
                            while os.path.exists(full_path):
                                seq += 1
                                if filename_number_padding > 0:
                                    seq_str = str(seq).zfill(filename_number_padding)
                                else:
                                    seq_str = str(seq)
                                base_name = f"{filename_prefix}{filename_separator}{seq_str}"
                                filename = f"{base_name}.{file_extension}"
                                full_path = os.path.join(local_save_path, filename)
                            logger.info(f"文件已存在，自动递增编号: {original_seq} → {seq}")
                        
                        pnginfo = self._build_pnginfo(meta, save_metadata_in_png)
                        self._save_image(img, full_path, file_extension, dpi, quality, optimize_image, high_quality_webp, pnginfo=pnginfo)
                        
                        # 可选：将 metadata 写入同名 json
                        if save_metadata_json and meta:
                            try:
                                import json
                                with open(full_path + ".json", "w", encoding="utf-8") as f:
                                    json.dump(meta, f, ensure_ascii=False, indent=2)
                            except Exception as e:
                                logger.warning(f"本地元数据写入失败: {e}")
                        local_count += 1
                    except Exception as e:
                        logger.error(f"本地保存失败: {e}")

                # B. Eagle 保存
                if save_to_eagle:
                    temp_path = os.path.join(temp_dir, filename)
                    pnginfo = self._build_pnginfo(meta, save_metadata_in_png)
                    self._save_image(img, temp_path, file_extension, dpi, quality, optimize_image, high_quality_webp, pnginfo=pnginfo)
                    temp_files.append(temp_path)

                    res = eagle_client.add_item_from_path(
                        temp_path,
                        folder_id=folder_id,
                        name=base_name,
                        tags=tags_list,
                        annotation=annotation,
                        star=star,
                        meta=meta
                    )
                    # 兼容返回值异常（理论上应为 dict）
                    if isinstance(res, dict):
                        if res.get("status") == "success":
                            success_count += 1
                            if res.get("metadataWarning"):
                                warning = str(res.get("metadataWarning"))
                                eagle_errors.append(f"{filename}: 已导入，但 {warning}")
                                logger.warning(f"Eagle 元数据更新提示: {warning}")
                        else:
                            message = str(res.get("message") or "未知错误")
                            eagle_errors.append(f"{filename}: {message}")
                            logger.error(f"Eagle 导入失败: {message}")
                    else:
                        message = f"返回类型异常 {type(res).__name__}: {res}"
                        eagle_errors.append(f"{filename}: {message}")
                        logger.error(f"Eagle 导入失败（{message}）")

                # ✅ 本张处理完成，序号递增到下一张
                seq += 1

            except Exception as e:
                logger.error(f"处理第 {idx+1} 张图片时出错: {e}")

        # ✅ 5. 更新全局计数器（用于纯 Eagle 保存场景）
        if save_to_eagle and folder_id:
            counter_key = f"{folder_id}_{filename_prefix}_{filename_separator}_{file_extension}"
            EagleSaver._global_counter[counter_key] = seq - 1  # seq 已经递增到下一个，所以减 1

        # 6. 延时清理临时文件
        if temp_files:
            time.sleep(1.0)  # 给 Eagle 一点响应时间
            for tf in temp_files:
                try:
                    if os.path.exists(tf): 
                        os.unlink(tf)
                except: 
                    pass
        if temp_dir:
            try:
                os.rmdir(temp_dir)
            except Exception:
                pass

        # 7. 汇总
        summary = f"保存完成 - Eagle: {success_count}/{len(images)}, 本地: {local_count}/{len(images)}{folder_correction}"
        if eagle_errors:
            summary += "\n" + "\n".join(eagle_errors[:8])

        return (summary,)

    def _build_pnginfo(self, meta, save_metadata_in_png):
        """构建 PIL PngInfo 对象，将元数据以 tEXt/zTXt 块嵌入 PNG，与 ComfyUI 默认保存一致。"""
        if not save_metadata_in_png or not meta:
            return None
        try:
            from PIL.PngImagePlugin import PngInfo
            import json
            pnginfo = PngInfo()
            # ComfyUI 默认使用这两个 key：prompt / workflow
            if "prompt" in meta:
                pnginfo.add_text("prompt", json.dumps(meta["prompt"], ensure_ascii=False))
            if "comfy_workflow" in meta:
                pnginfo.add_text("workflow", json.dumps(meta["comfy_workflow"], ensure_ascii=False))
            # 额外写入完整的 Eagle Suite 元数据，便于自定义读取
            pnginfo.add_text("eagle_suite_meta", json.dumps(meta, ensure_ascii=False))
            return pnginfo
        except Exception as e:
            logger.warning(f"构建 PNG 元数据失败: {e}")
            return None

    def _save_image(self, img, path, ext, dpi, quality, optimize_image, high_quality_webp, pnginfo=None):
        """统一图片保存逻辑，支持 PNG/JPG/WebP/BMP 及 DPI 设置；PNG 支持嵌入 PngInfo。"""
        ext = ext.lower()
        if ext == "png":
            img.save(path, format="PNG", optimize=optimize_image, dpi=(dpi, dpi), pnginfo=pnginfo)
        elif ext == "jpg" or ext == "jpeg":
            rgb = img.convert("RGB") if img.mode != "RGB" else img
            rgb.save(path, format="JPEG", quality=quality, optimize=optimize_image, dpi=(dpi, dpi))
        elif ext == "webp":
            rgb = img.convert("RGB") if img.mode != "RGB" else img
            method = 6 if high_quality_webp else 4
            rgb.save(path, format="WEBP", quality=quality, method=method, optimize=optimize_image)
        elif ext == "bmp":
            img.save(path, format="BMP")
        else:
            img.save(path, format="PNG", optimize=optimize_image, dpi=(dpi, dpi), pnginfo=pnginfo)

    def _build_metadata(self, prompt, extra_pnginfo):
        """从 ComfyUI 隐藏的 prompt / extra_pnginfo 中提取生成参数作为 JSON 元数据。"""
        meta = {}
        try:
            if extra_pnginfo and isinstance(extra_pnginfo, dict):
                workflow = extra_pnginfo.get("workflow") or {}
                # 把整个工作流节点字典暴露出来，便于 Eagle 内按 customtitle / type 搜索
                meta["comfy_workflow"] = workflow

                # 尝试从 extra_pnginfo 的 prompt 中提取各 KSampler 参数
                prompt_data = extra_pnginfo.get("prompt")
                if prompt_data and isinstance(prompt_data, dict):
                    meta["prompt"] = prompt_data
                    samplers = []
                    for node_id, node in prompt_data.items():
                        if not isinstance(node, dict):
                            continue
                        class_type = node.get("class_type", "")
                        if "KSampler" in class_type or "Sampler" in class_type:
                            inputs = node.get("inputs", {})
                            sampler_info = {
                                "node_id": node_id,
                                "class_type": class_type,
                                "seed": inputs.get("seed"),
                                "steps": inputs.get("steps"),
                                "cfg": inputs.get("cfg"),
                                "sampler_name": inputs.get("sampler_name"),
                                "scheduler": inputs.get("scheduler"),
                            }
                            # 连接模型信息
                            model_ref = inputs.get("model")
                            if isinstance(model_ref, list) and len(model_ref) >= 1:
                                sampler_info["model_node_id"] = model_ref[0]
                            samplers.append(sampler_info)
                    if samplers:
                        meta["samplers"] = samplers

            # prompt 参数是 ComfyUI 传给当前节点的前置节点输入信息（如果有连接）
            if prompt and isinstance(prompt, dict):
                meta["inputs"] = prompt
        except Exception as e:
            logger.warning(f"构建元数据时出错: {e}")
        return meta if meta else None

__all__ = ["EagleSaver"]
