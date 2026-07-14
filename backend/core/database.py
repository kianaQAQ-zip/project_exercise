# backend/core/database.py
"""
数据库连接管理模块。

职责：
1. 创建 AsyncEngine（异步数据库引擎）
2. 提供 async_sessionmaker 工厂
3. 提供 get_db() 依赖注入函数（供路由层使用）
4. Lifespan 中初始化/关闭连接池
5. 当 PostgreSQL 不可用时自动降级为 SQLite

⚠️ 铁律：
- 禁止在此处执行任何 DDL/DML 操作
- 禁止导入业务逻辑模块（避免循环依赖）
- 连接池大小必须从 settings 读取
"""

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
    AsyncEngine,
)

from backend.core.config import settings

logger = logging.getLogger(__name__)

_db_type: str = "unknown"
engine: Optional[AsyncEngine] = None
async_session_factory: Optional[async_sessionmaker] = None


def _create_pg_engine() -> AsyncEngine:
    pg_url = str(settings.POSTGRES_URL)
    return create_async_engine(
        pg_url,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=settings.DB_POOL_RECYCLE,
        echo=settings.DEBUG,
    )


def _create_sqlite_engine() -> AsyncEngine:
    db_dir = Path(__file__).parent.parent.parent / "data"
    db_dir.mkdir(parents=True, exist_ok=True)
    sqlite_path = db_dir / "enterprise_ai.db"
    sqlite_url = f"sqlite+aiosqlite:///{sqlite_path.as_posix()}"
    return create_async_engine(
        sqlite_url,
        echo=settings.DEBUG,
        connect_args={"check_same_thread": False},
    )


def create_engine() -> AsyncEngine:
    """根据当前数据库类型创建对应的引擎（供 Celery Worker / 同步回退线程使用）"""
    if _db_type == "sqlite":
        return _create_sqlite_engine()
    return _create_pg_engine()


# ============================================================================
# 2. 创建 Session 工厂（延迟初始化）
# ============================================================================

def _init_factory() -> None:
    global async_session_factory
    if async_session_factory is None and engine is not None:
        async_session_factory = async_sessionmaker(
            bind=engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autocommit=False,
            autoflush=False,
        )


# ============================================================================
# 3. 依赖注入函数（供 FastAPI Depends 使用）
# ============================================================================

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI 依赖注入：为每个请求提供独立的 AsyncSession。

    用法：
        @router.get("/list")
        async def list_docs(db: AsyncSession = Depends(get_db)):
            docs = await db.execute(select(Document))
    """
    if async_session_factory is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db()")
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ============================================================================
# 4. 生命周期管理（供 main.py lifespan 调用）
# ============================================================================

async def init_db() -> None:
    """应用启动时初始化数据库：优先 PostgreSQL，失败则降级为 SQLite 并建表"""
    global engine, _db_type, async_session_factory
    from backend.models.db_models import Base

    logger.info("🗄️ 数据库初始化中...")

    # 1) 尝试 PostgreSQL
    pg_engine = _create_pg_engine()
    try:
        async with pg_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _migrate_columns(conn)
        engine = pg_engine
        _db_type = "postgresql"
        _init_factory()
        logger.info("✅ 数据库已就绪 | 类型=PostgreSQL | 表结构已同步")
        return
    except Exception as e:
        logger.warning("⚠️ PostgreSQL 不可用 (%s)，降级为 SQLite", e)
        await pg_engine.dispose()

    # 2) 降级为 SQLite
    sqlite_engine = _create_sqlite_engine()
    async with sqlite_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_columns(conn)
    engine = sqlite_engine
    _db_type = "sqlite"
    _init_factory()
    sqlite_path = Path(__file__).parent.parent.parent / "data" / "enterprise_ai.db"
    logger.info("✅ 数据库已就绪 | 类型=SQLite | 路径=%s | 表结构已同步", sqlite_path)


async def _migrate_columns(conn) -> None:
    """自动迁移：为已存在的表添加缺失的列"""
    from sqlalchemy import text, inspect

    def _sync(sync_conn):
        inspector = inspect(sync_conn)
        # 检查 documents 表是否有 category 列
        if "documents" in inspector.get_table_names():
            existing_cols = [c["name"] for c in inspector.get_columns("documents")]
            if "category" not in existing_cols:
                logger.info("[Migration] 为 documents 表添加 category 列")
                sync_conn.execute(text("ALTER TABLE documents ADD COLUMN category VARCHAR(100)"))

    await conn.run_sync(_sync)


async def close_db() -> None:
    """应用关闭时释放连接池"""
    global engine
    if engine is not None:
        logger.info("🛑 正在关闭数据库连接池...")
        await engine.dispose()
        engine = None
        logger.info("✅ 数据库连接池已关闭")


def get_db_type() -> str:
    """返回当前使用的数据库类型: 'postgresql' | 'sqlite' | 'unknown'"""
    return _db_type