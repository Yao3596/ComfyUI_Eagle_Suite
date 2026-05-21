# -*- coding: utf-8 -*-
"""
Eagle MCP Server
允许 AI 助手直接搜索、浏览和管理 Eagle 库中的资产
独立运行，不依赖 ComfyUI 环境
"""

import os
import sys
import json
import requests

# 确保可以导入 mcp 包
try:
    from mcp.server.fastmcp import FastMCP
except ImportError:
    print("Error: mcp package not installed. Run: pip install mcp")
    sys.exit(1)

# 初始化 FastMCP
mcp = FastMCP("Eagle")

EAGLE_API_URL = "http://localhost:41595/api"

@mcp.tool()
def search_eagle_items(keyword: str = "", tags: str = "", limit: int = 10):
    """
    搜索 Eagle 库中的资产。
    :param keyword: 搜索关键词
    :param tags: 标签（多个用逗号分隔）
    :param limit: 返回结果数量限制
    """
    try:
        params = {
            "keyword": keyword,
            "limit": limit
        }
        if tags:
            params["tags"] = tags
            
        response = requests.get(f"{EAGLE_API_URL}/item/list", params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                items = data.get("data", [])
                result = []
                for item in items:
                    result.append({
                        "id": item.get("id"),
                        "name": item.get("name"),
                        "ext": item.get("ext"),
                        "tags": item.get("tags"),
                        "url": f"eagle://item/{item.get('id')}"
                    })
                return json.dumps(result, ensure_ascii=False, indent=2)
        return "未找到相关资产或 Eagle 未启动"
    except Exception as e:
        return f"搜索出错: {str(e)}"

@mcp.tool()
def get_eagle_folders():
    """
    获取 Eagle 的文件夹结构。
    用于了解资源库的分类情况。
    """
    try:
        response = requests.get(f"{EAGLE_API_URL}/folder/list", timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                return json.dumps(data.get("data", []), ensure_ascii=False, indent=2)
        return "无法获取文件夹列表"
    except Exception as e:
        return f"获取失败: {str(e)}"

@mcp.tool()
def get_item_info(item_id: str):
    """
    获取指定 Eagle 资产的详细信息（包括备注、来源 URL 等）。
    """
    try:
        response = requests.get(f"{EAGLE_API_URL}/item/info", params={"id": item_id}, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "success":
                return json.dumps(data.get("data", []), ensure_ascii=False, indent=2)
        return "未找到该资产信息"
    except Exception as e:
        return f"获取详情失败: {str(e)}"

@mcp.tool()
def add_item_from_url(url: str, name: str, folder_id: str = None, tags: str = ""):
    """
    从 URL 添加图片到 Eagle。
    """
    try:
        payload = {
            "url": url,
            "name": name
        }
        if folder_id:
            payload["folderId"] = folder_id
        if tags:
            payload["tags"] = [t.strip() for t in tags.split(",") if t.strip()]
            
        response = requests.post(f"{EAGLE_API_URL}/item/addFromURL", json=payload, timeout=20)
        if response.status_code == 200:
            return "成功添加到 Eagle"
        return f"添加失败: {response.text}"
    except Exception as e:
        return f"操作出错: {str(e)}"

if __name__ == "__main__":
    mcp.run()
