# -*- coding: utf-8 -*-
"""
Eagle 图片保存器
迁移自 nodes/eagle_saver.py
"""

import os
import json
import requests
from datetime import datetime
import numpy as np
from PIL import Image
import tempfile
import re
import time
import uuid


class EagleSaver:
    """Eagle 图片保存器"""

    def __init__(self):
        self.eagle_api_url = "http://localhost:41595/api"
        self.folder_cache = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "eagle_folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Eagle文件夹路径/ID"
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
                "tags": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "用逗号分隔"
                }),
                "star": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 5,
                    "step": 1,
                }),
                "annotation": ("STRING", {
                    "default": "",
                    "multiline": True,
                }),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("保存结果",)
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    CATEGORY = "🦅 Eagle"

    # ── 唯一文件名生成 ──

    def generate_unique_filename(self, prefix, index):
        date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        short_id = uuid.uuid4().hex[:6]
        name = f"{prefix}_{date_str}_{index}_{short_id}"
        return name

    # ── 输入解析（与 EagleLoader 保持一致）──

    def parse_folder_input(self, folder_input):
        folder_input = folder_input.strip()

        if not folder_input:
            return None, None

        # eagle:// 协议
        if folder_input.startswith("eagle://folder/"):
            folder_id = folder_input.replace("eagle://folder/", "").strip()
            return folder_id, "eagle_id"

        # HTTP API URL
        if "localhost:41595" in folder_input or "127.0.0.1:41595" in folder_input:
            match = re.search(r'[?&]id=([A-Z0-9]+)', folder_input)
            if match:
                return match.group(1), "eagle_id"

        # 本地路径 / 网络路径
        if (os.path.isabs(folder_input)
                or folder_input.startswith("\\\\")
                or folder_input.startswith("//")
                or (len(folder_input) >= 2 and folder_input[1] == ":")):
            return folder_input, "local_path"

        # 13位大写字母数字 → Eagle 文件夹 ID
        if len(folder_input) == 13 and folder_input.isalnum() and folder_input.isupper():
            return folder_input, "eagle_id"

        # 其余当作 Eagle 文件夹名称/路径
        return folder_input, "eagle_name"

    # ── Eagle API 基础方法 ──

    def get_folders(self):
        if self.folder_cache is not None:
            return self.folder_cache

        try:
            response = requests.get(f"{self.eagle_api_url}/folder/list")
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    self.folder_cache = data.get("data", [])
                    return self.folder_cache
        except Exception as e:
            print(f"❌ 获取文件夹列表失败: {e}")
        return []

    # ── 文件夹查找 ──

    def find_folder_by_path(self, folders, path):
        path_parts = [p.strip() for p in path.split("/") if p.strip()]

        def search(folder_list, parts, depth=0):
            if depth >= len(parts):
                return None
            for f in folder_list:
                if f.get("name") == parts[depth]:
                    if depth == len(parts) - 1:
                        return f.get("id")
                    children = f.get("children", [])
                    if children:
                        result = search(children, parts, depth + 1)
                        if result:
                            return result
            return None

        return search(folders, path_parts)

    def get_folder_info_by_id(self, folder_id):
        try:
            folders = self.get_folders()

            def search(folder_list, parent_path=""):
                for f in folder_list:
                    cur = f"{parent_path}/{f.get('name', '')}" if parent_path else f.get('name', '')
                    if f.get("id") == folder_id:
                        return {"name": f.get("name", ""), "path": cur}
                    children = f.get("children", [])
                    if children:
                        result = search(children, cur)
                        if result:
                            return result
                return None

            return search(folders)
        except Exception as e:
            print(f"⚠️ 获取文件夹信息失败: {e}")
            return None

    # ── 本地保存 ──

    def save_to_local(self, img, local_path, filename):
        try:
            os.makedirs(local_path, exist_ok=True)
            full_path = os.path.join(local_path, filename)
            img.save(full_path, format="PNG")
            print(f"💾 本地保存成功: {full_path}")
            return full_path
        except Exception as e:
            print(f"❌ 本地保存失败: {e}")
            return None

    # ── 主函数 ──

    def save_images(self, images, eagle_folder, local_save_path="",
                    filename_prefix="ComfyUI", tags="", star=0, annotation=""):

        print("\n" + "=" * 60)
        print("🦅 Eagle 图片保存器")
        print("=" * 60)

        save_to_eagle = bool(eagle_folder.strip())
        save_to_local = bool(local_save_path.strip())

        if not save_to_eagle and not save_to_local:
            raise Exception("❌ 请至少指定 Eagle 文件夹或本地保存路径")

        # 解析 Eagle 文件夹
        folder_id = None
        if save_to_eagle:
            value, input_type = self.parse_folder_input(eagle_folder)

            if not value:
                raise Exception("❌ 请输入有效的 Eagle 文件夹路径或 ID")

            print(f"🔍 输入类型: {input_type}")

            if input_type == "eagle_id":
                folder_id = value
                folder_info = self.get_folder_info_by_id(folder_id)
                if folder_info:
                    print(f"📂 Eagle 文件夹: {folder_info.get('name', '')}")
                    print(f"🆔 ID: {folder_id}")
                else:
                    print(f"📂 Eagle 文件夹 ID: {folder_id}")

            elif input_type == "eagle_name":
                folders = self.get_folders()
                folder_id = self.find_folder_by_path(folders, value)
                if not folder_id:
                    raise Exception(f"❌ 找不到 Eagle 文件夹: {value}")
                print(f"📂 Eagle 文件夹: {value} (ID: {folder_id})")

            elif input_type == "local_path":
                print(f"⚠️ 检测到本地路径，请使用 local_save_path 参数保存到本地")
                print(f"   Eagle 文件夹请输入文件夹名称或 ID")
                save_to_eagle = False

        if save_to_local:
            print(f"💾 本地保存路径: {local_save_path}")

        if not save_to_eagle and not save_to_local:
            raise Exception("❌ 没有有效的保存目标")

        tags_list = [t.strip() for t in re.split(r'[,，]', tags) if t.strip()]

        results = []
        success_count = 0
        local_count = 0
        temp_files = []

        for idx, image in enumerate(images):
            try:
                i = 255. * image.cpu().numpy()
                img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

                unique_name = self.generate_unique_filename(filename_prefix, idx)
                filename = f"{unique_name}.png"

                print(f"\n📤 处理图片 {idx + 1}/{len(images)}: {filename}")

                # 本地保存
                if save_to_local:
                    local_path_saved = self.save_to_local(img, local_save_path, filename)
                    if local_path_saved:
                        local_count += 1

                # Eagle 保存
                if save_to_eagle:
                    temp_path = os.path.join(tempfile.gettempdir(), filename)
                    img.save(temp_path, format="PNG")
                    temp_files.append(temp_path)

                    request_data = {
                        'path': temp_path,
                        'folderId': folder_id,
                        'name': unique_name,
                    }

                    if annotation:
                        request_data['annotation'] = annotation
                    if star > 0:
                        request_data['star'] = star

                    response = requests.post(
                        f"{self.eagle_api_url}/item/addFromPath",
                        json=request_data,
                        timeout=30
                    )

                    if response.status_code == 200:
                        result = response.json()
                        if result.get("status") == "success":
                            # addFromPath 后单独更新 tags
                            if tags_list:
                                item_id = result.get("data", {}).get("id")
                                if item_id:
                                    requests.post(
                                        f"{self.eagle_api_url}/item/update",
                                        json={"id": item_id, "tags": tags_list},
                                        timeout=30
                                    )
                            print(f"✅ Eagle 保存成功")
                            results.append(f"✅ {unique_name}")
                            success_count += 1
                        else:
                            error_msg = result.get("message", "未知错误")
                            print(f"❌ Eagle 保存失败: {error_msg}")
                            results.append(f"❌ {unique_name}: {error_msg}")
                    else:
                        print(f"❌ Eagle API 请求失败: {response.status_code}")
                        results.append(f"❌ {unique_name}: HTTP {response.status_code}")

            except Exception as e:
                print(f"❌ 处理图片 {idx + 1} 时出错: {e}")
                results.append(f"❌ 图片 {idx + 1}: {e}")

        # 延迟清理临时文件
        if temp_files:
            print(f"\n🧹 等待 Eagle 完成文件拷贝后清理临时文件...")
            time.sleep(3.0)
            for tf in temp_files:
                try:
                    if os.path.exists(tf):
                        os.unlink(tf)
                except Exception:
                    pass

        # 汇总
        print("\n" + "=" * 60)
        summary_parts = []
        if save_to_eagle:
            summary_parts.append(f"Eagle: {success_count}/{len(images)}")
        if save_to_local:
            summary_parts.append(f"本地: {local_count}/{len(images)}")

        summary = "保存完成 - " + ", ".join(summary_parts)
        print(f"📊 {summary}")
        print("=" * 60 + "\n")

        return (summary,)


__all__ = ["EagleSaver"]
