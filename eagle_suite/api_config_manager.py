# -*- coding: utf-8 -*-
import os
import json

_SAVER_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "eagle_saver_config.json")

def load_saver_config() -> dict:
    try:
        if os.path.exists(_SAVER_CONFIG_PATH):
            with open(_SAVER_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except: pass
    return {}

def save_saver_config(config: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_SAVER_CONFIG_PATH), exist_ok=True)
        with open(_SAVER_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        from .logger import logger
        logger.error(f"保存配置失败: {e}")
