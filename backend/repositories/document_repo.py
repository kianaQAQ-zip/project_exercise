# backend/repositories/document_repo.py
"""
文档数据访问层。

职责：
1. 文档 CRUD
2. 按部门/用户过滤查询
3. SHA256 防重查询
4. 批量更新处理状态
"""

from typing import Optional, List, Dict, Any
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models.db_models import Document, DocumentStatus, Chunk
from backend.repositories.base import BaseRepository


class DocumentRepository(BaseRepository[Document]):
    """文档专属 Repository"""

    def __init__(self):
        super().__init__(Document)

    async def get_by_file_hash(self, db: AsyncSession, file_hash: str) -> Optional[Document]:
        """根据文件哈希查询（防重复上传）"""
        result = await db.execute(
            select(Document).where(Document.file_hash == file_hash)
        )
        return result.scalar_one_or_none()

    async def list_by_user(
        self,
        db: AsyncSession,
        user_id: str,
        skip: int = 0,
        limit: int = 20,
        category: Optional[str] = None,
    ) -> tuple[List[Document], int]:
        """分页查询指定用户的文档列表，支持按分类筛选"""
        from sqlalchemy import and_

        conditions = [Document.user_id == user_id]
        if category:
            conditions.append(Document.category == category)
        where_clause = and_(*conditions)

        # 查询总数
        count_result = await db.execute(select(func.count()).where(where_clause))
        total = count_result.scalar_one()

        # 查询数据
        result = await db.execute(
            select(Document)
            .where(where_clause)
            .order_by(Document.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        items = result.scalars().all()
        return items, total

    async def list_categories(self, db: AsyncSession, user_id: str) -> List[str]:
        """获取指定用户的所有已有分类"""
        from sqlalchemy import distinct
        result = await db.execute(
            select(distinct(Document.category))
            .where(Document.user_id == user_id, Document.category.isnot(None))
            .order_by(Document.category)
        )
        return [row[0] for row in result.all() if row[0]]

    async def update_status(
        self,
        db: AsyncSession,
        doc_id: str,
        status: DocumentStatus,
        error_msg: Optional[str] = None,
    ) -> Optional[Document]:
        """更新文档处理状态"""
        update_data = {"status": status}
        if error_msg:
            update_data["error_msg"] = error_msg
        return await self.update(db, doc_id, update_data)

    async def update_category(
        self,
        db: AsyncSession,
        doc_id: str,
        category: str,
    ) -> Optional[Document]:
        """更新文档分类"""
        return await self.update(db, doc_id, {"category": category})

    async def get_with_chunks(self, db: AsyncSession, doc_id: str) -> Optional[Document]:
        """查询文档及其关联的文本块"""
        result = await db.execute(
            select(Document)
            .options(selectinload(Document.chunks))
            .where(Document.id == doc_id)
        )
        return result.scalar_one_or_none()

    async def save_chunks(
        self,
        db: AsyncSession,
        doc_id: str,
        chunks: List[Dict[str, Any]],
    ) -> List[Chunk]:
        """批量保存文档分块到 PostgreSQL（embedding 直接存入 Chunk.embedding 列）"""
        chunk_objs = []
        for c in chunks:
            embedding = c.pop("embedding", None)
            chunk_obj = Chunk(
                document_id=doc_id,
                chunk_index=c.get("chunk_index", 0),
                content=c.get("content", ""),
                embedding=embedding,  # 直接存入 embedding 列
                chunk_metadata=c.get("metadata") or {},
                vector_id=c.get("vector_id", None),
            )
            db.add(chunk_obj)
            chunk_objs.append(chunk_obj)
        await db.flush()
        return chunk_objs

    async def get_unsynced_chunks(
        self,
        db: AsyncSession,
        limit: int = 100,
    ) -> List[Chunk]:
        """获取尚未同步到向量库的分块（vector_id 为 NULL）"""
        result = await db.execute(
            select(Chunk)
            .where(Chunk.vector_id.is_(None))
            .limit(limit)
        )
        return list(result.scalars().all())


# 导出单例
document_repo = DocumentRepository()