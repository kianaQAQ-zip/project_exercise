# backend/repositories/base.py
"""
泛型 Repository 基类。

提供通用的 CRUD 操作，子类只需指定 Model 类型即可继承全部能力。
"""

from typing import Generic, TypeVar, Type, Optional, List
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db_models import Base

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """泛型 CRUD 基类"""

    def __init__(self, model: Type[ModelType]):
        self.model = model

    async def get_by_id(self, db: AsyncSession, id: str) -> Optional[ModelType]:
        """根据主键 ID 查询单条记录"""
        result = await db.execute(select(self.model).where(self.model.id == id))
        return result.scalar_one_or_none()

    async def create(self, db: AsyncSession, obj_in: dict) -> ModelType:
        """创建新记录"""
        db_obj = self.model(**obj_in)
        db.add(db_obj)
        await db.flush()
        await db.refresh(db_obj)
        return db_obj

    async def update(self, db: AsyncSession, id: str, obj_in: dict) -> Optional[ModelType]:
        """更新记录（部分字段）"""
        db_obj = await self.get_by_id(db, id)
        if not db_obj:
            return None
        for field, value in obj_in.items():
            setattr(db_obj, field, value)
        await db.flush()
        await db.refresh(db_obj)
        return db_obj

    async def delete(self, db: AsyncSession, id: str) -> bool:
        """删除记录"""
        db_obj = await self.get_by_id(db, id)
        if not db_obj:
            return False
        await db.delete(db_obj)
        await db.flush()
        return True

    async def list_all(
        self,
        db: AsyncSession,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ModelType]:
        """分页查询所有记录"""
        result = await db.execute(
            select(self.model).offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def count(self, db: AsyncSession) -> int:
        """统计总记录数"""
        result = await db.execute(select(func.count()).select_from(self.model))
        return result.scalar_one()