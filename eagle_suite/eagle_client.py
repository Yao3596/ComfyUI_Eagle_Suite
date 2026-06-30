# -*- coding: utf-8 -*-
import os
import re
import requests
import json
from .logger import logger

class EagleClient:
    """Eagle API 统一客户端"""
    
    DEFAULT_URL = "http://localhost:41595/api"

    def __init__(self, base_url=None):
        self._base_url = (base_url or self.DEFAULT_URL).rstrip('/')
        self._folder_cache = None

    @property
    def base_url(self):
        return self._base_url

    def parse_folder_input(self, folder_input):
        """解析多种格式的文件夹输入（ID, URL, 名称, 路径）"""
        if not folder_input or not isinstance(folder_input, str):
            return None, None
        
        s = folder_input.strip()
        if not s:
            return None, None

        # 1. eagle:// 协议
        if s.startswith("eagle://folder/"):
            return s.replace("eagle://folder/", "").strip(), "eagle_id"

        # 2. HTTP API URL
        if "localhost:41595" in s or "127.0.0.1:41595" in s:
            match = re.search(r'[?&]id=([A-Z0-9]+)', s)
            if match:
                return match.group(1), "eagle_id"

        # 3. 本地路径校验 (用于 Saver 区分)
        if (os.path.isabs(s) or s.startswith("\\") or s.startswith("//") or 
            (len(s) >= 2 and s[1] == ":")):
            return s, "local_path"

        # 4. Eagle 标准 ID (13位大写数字/字母)
        if len(s) == 13 and s.isalnum() and s.isupper():
            return s, "eagle_id"

        # 5. 默认为名称或层级路径
        return s, "eagle_name"

    def get_folders(self, force_refresh=False):
        """获取文件夹树列表"""
        if self._folder_cache is not None and not force_refresh:
            return self._folder_cache

        try:
            resp = requests.get(f"{self.base_url}/folder/list", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    self._folder_cache = data.get("data", [])
                    return self._folder_cache
        except Exception as e:
            logger.error(f"获取 Eagle 文件夹列表失败: {e}")
        return []

    def find_folder_id_by_path(self, path):
        """通过 '一级/二级' 路径或名称查找 ID"""
        folders = self.get_folders()
        if not folders:
            return None
            
        parts = [p.strip() for p in path.split("/") if p.strip()]
        if not parts:
            return None
        
        def search(nodes, depth=0):
            if depth >= len(parts): return None
            for node in nodes:
                if node.get("name") == parts[depth]:
                    if depth == len(parts) - 1:
                        return node.get("id")
                    children = node.get("children", [])
                    res = search(children, depth + 1)
                    if res: return res
            return None
        return search(folders)

    def get_folder_info_by_id(self, folder_id):
        """递归查找文件夹信息"""
        folders = self.get_folders()
        
        def search(nodes, parent_path=""):
            for f in nodes:
                name = f.get("name", "")
                current_path = f"{parent_path}/{name}" if parent_path else name
                if f.get("id") == folder_id:
                    return {
                        "id": folder_id,
                        "name": name,
                        "path": current_path,
                        "description": f.get("description", ""),
                        "icon": f.get("icon", ""),
                        "iconColor": f.get("iconColor", "")
                    }
                children = f.get("children", [])
                if children:
                    res = search(children, current_path)
                    if res: return res
            return None
        return search(folders)

    def get_library_path(self):
        """获取资源库真实路径"""
        try:
            resp = requests.get(f"{self.base_url}/library/info", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    return data.get("data", {}).get("library", {}).get("path", "")
        except Exception as e:
            logger.warning(f"获取 Eagle 资源库路径失败: {e}")
        return None

    def add_item_from_path(self, file_path, folder_id=None, name=None, tags=None, annotation=None, star=0):
        """导入本地文件到 Eagle"""
        payload = {
            "path": file_path,
            "folderId": folder_id,
            "name": name or os.path.splitext(os.path.basename(file_path))[0],
            "star": star
        }
        if annotation: payload["annotation"] = annotation
        
        try:
            resp = requests.post(f"{self.base_url}/item/addFromPath", json=payload, timeout=60)
            if resp.status_code == 200:
                res_data = resp.json()
                if res_data.get("status") == "success":
                    item_id = res_data.get("data", {}).get("id")
                    if item_id and (tags or annotation):
                        self.update_item(item_id, tags=tags, annotation=annotation)
                    return res_data
            return {"status": "error", "message": f"HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def add_item_from_file(self, file_path, folder_id=None, name=None, tags=None, annotation=None, star=0):
        """以文件上传方式导入到 Eagle (适用于内存数据或临时文件)"""
        filename = os.path.basename(file_path)
        try:
            with open(file_path, "rb") as f:
                files = {"file": (filename, f, "image/png")}
                data = {"folderId": folder_id or ""}
                if star > 0: data["star"] = star
                
                resp = requests.post(f"{self.base_url}/item/addFromFile", files=files, data=data, timeout=60)
                if resp.status_code == 200:
                    res_data = resp.json()
                    if res_data.get("status") == "success":
                        item_id = res_data.get("data", {}).get("id")
                        if item_id and (tags or annotation or name):
                            self.update_item(item_id, name=name, tags=tags, annotation=annotation)
                        return res_data
            return {"status": "error", "message": f"HTTP {resp.status_code}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def update_item(self, item_id, name=None, tags=None, annotation=None, star=None):
        """更新已有条目信息"""
        if not item_id: return
        data = {"id": item_id}
        if name: data["name"] = name
        if tags: data["tags"] = tags
        if annotation: data["annotation"] = annotation
        if star is not None: data["star"] = star
        try:
            requests.post(f"{self.base_url}/item/update", json=data, timeout=30)
        except Exception as e:
            logger.warning(f"更新条目 {item_id} 失败: {e}")

    def get_subfolder_ids(self, folder_id):
        """获取指定文件夹下所有子文件夹的 ID 列表"""
        folders = self.get_folders()
        target = self._find_node_by_id(folders, folder_id)
        if not target: return []
        
        ids = []
        def collect(node):
            for ch in node.get("children", []):
                cid = ch.get("id")
                if cid:
                    ids.append(cid)
                    collect(ch)
        collect(target)
        return ids

    def _find_node_by_id(self, nodes, target_id):
        for n in nodes:
            if n.get("id") == target_id: return n
            res = self._find_node_by_id(n.get("children", []), target_id)
            if res: return res
        return None

    def get_folder_item_count(self, folder_id, include_subfolders=True):
        """获取文件夹内项目总数"""
        folders = self.get_folders()
        target = self._find_node_by_id(folders, folder_id)
        if not target: return 0
        
        def count_recursive(node):
            c = node.get("imageCount", 0) or node.get("count", 0) or 0
            if include_subfolders:
                for ch in node.get("children", []):
                    c += count_recursive(ch)
            return c
        return count_recursive(target)

    def get_items_in_folder(self, folder_id, limit=2000, offset=0, include_subfolders=True):
        """获取文件夹内的项目列表"""
        folder_ids = [folder_id]
        if include_subfolders:
            folder_ids.extend(self.get_subfolder_ids(folder_id))
        
        all_items = []
        # 注意：Eagle API 目前一次只能查询一个或多个文件夹，通过逗号分隔
        # 如果子文件夹太多，建议分批或直接传多个 ID
        try:
            fids_str = ",".join(folder_ids)
            resp = requests.get(f"{self.base_url}/item/list", 
                               params={"folders": fids_str, "limit": limit, "offset": offset}, 
                               timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    return data.get("data", [])
        except Exception as e:
            logger.error(f"获取项目列表失败: {e}")
        return []

    def get_item_info(self, item_id):
        """获取单个条目的详细信息（含文件路径）"""
        try:
            resp = requests.get(f"{self.base_url}/item/info", params={"id": item_id}, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    return data.get("data", {})
        except Exception: pass
        return None

    def get_item_thumbnail(self, item_id):
        """获取缩略图字节数据"""
        try:
            resp = requests.get(f"{self.base_url}/item/thumbnail", params={"id": item_id}, timeout=10)
            if resp.status_code == 200:
                return resp.content
        except Exception: pass
        return None

# 全局单例
eagle_client = EagleClient()
