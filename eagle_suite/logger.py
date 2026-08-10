"""
Eagle Suite 日志系统
参考 videohelpersuite 的 logger 实现
"""

import logging
import sys

# 创建 logger
logger = logging.getLogger("EagleSuite")
logger.setLevel(logging.INFO)

# 避免重复添加 handler
if not logger.handlers:
    # 控制台 Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    
    # 格式化器
    formatter = logging.Formatter(
        fmt='[EagleSuite] %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)

# 便捷方法
def info(msg):
    logger.info(msg)

def warn(msg):
    logger.warning(msg)

def error(msg):
    logger.error(msg)

def debug(msg):
    logger.debug(msg)
