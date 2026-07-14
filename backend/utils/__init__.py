# backend/utils/
"""
通用工具模块。

提供日志、时间、文件哈希、路径安全等纯函数工具。
所有函数均为无状态、无副作用的纯工具，不持有全局资源。

⚠️ 铁律：
- 禁止在此模块中初始化数据库/Redis 等外部连接
- 禁止重复配置根日志器（由 main.py lifespan 统一管理）
- 时间函数必须返回 timezone-aware 对象
- 文件操作必须包含路径安全校验
"""

import hashlib
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Union

# ============================================================================
# 1. 日志工具
# ============================================================================

def get_logger(name: str) -> logging.Logger:
    """
    获取命名日志器实例。

    仅创建/获取 logger，不修改其 handler 或 level。
    日志格式与级别由 main.py 中的 logging.basicConfig 统一控制。

    Args:
        name: 日志器名称，通常传入 __name__

    Returns:
        logging.Logger 实例
    """
    return logging.getLogger(name)


# ============================================================================
# 2. 时间工具
# ============================================================================

# 上海时区偏移量（UTC+8），预计算避免每次调用重建
_SHANGHAI_TZ = timezone(timedelta(hours=8))


def utc_now() -> datetime:
    """返回当前 UTC 时间（timezone-aware）。"""
    return datetime.now(timezone.utc)


def to_shanghai(dt: datetime) -> datetime:
    """
    将任意 timezone-aware 时间转换为上海时区。

    Args:
        dt: 必须为 timezone-aware 的 datetime 对象

    Raises:
        ValueError: 若传入 naive datetime（无时区信息）
    """
    if dt.tzinfo is None:
        raise ValueError(
            "拒绝处理 naive datetime，请先附加时区信息。"
            "使用 utc_now() 获取安全的当前时间。"
        )
    return dt.astimezone(_SHANGHAI_TZ)


def format_iso(dt: datetime) -> str:
    """
    将 datetime 格式化为 ISO 8601 字符串（含时区偏移）。

    输出示例：2026-05-30T17:05:00+08:00
    """
    return dt.isoformat()


# ============================================================================
# 3. 文件哈希工具
# ============================================================================

def sha256_file(file_path: Union[str, Path], chunk_size: int = 8192) -> str:
    """
    流式计算文件 SHA-256 哈希值。

    采用分块读取策略，避免大文件一次性加载导致 OOM。

    Args:
        file_path: 文件路径
        chunk_size: 每次读取字节数，默认 8KB

    Returns:
        十六进制小写哈希字符串

    Raises:
        FileNotFoundError: 文件不存在
        IsADirectoryError: 路径指向目录
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"哈希计算失败，文件不存在: {path}")
    if path.is_dir():
        raise IsADirectoryError(f"哈希计算失败，路径为目录: {path}")

    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


# ============================================================================
# 4. 路径安全工具
# ============================================================================

def safe_resolve(
    file_path: Union[str, Path],
    base_dir: Union[str, Path],
) -> Path:
    """
    安全解析文件路径，防止目录穿越攻击。

    将 file_path 解析为绝对路径后，校验其是否位于 base_dir 内部。
    即使 file_path 包含 ../ 或符号链接，只要最终解析结果越界即拒绝。

    Args:
        file_path: 待校验的文件路径
        base_dir: 合法的基目录（如 TEMP_UPLOAD_DIR）

    Returns:
        解析后的安全绝对路径

    Raises:
        PermissionError: 路径越界，疑似目录穿越攻击
    """
    resolved = Path(file_path).resolve()
    base = Path(base_dir).resolve()

    try:
        resolved.relative_to(base)
    except ValueError:
        raise PermissionError(
            f"路径安全校验失败: '{file_path}' 解析后超出合法目录 '{base_dir}'。"
            f"已拦截潜在的目录穿越攻击。"
        )
    return resolved