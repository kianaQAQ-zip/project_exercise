# backend/modules/vector_store.py
"""
向量存储层 —— 直接使用 PostgreSQL 存储 embedding + Python 计算余弦相似度。

替代了 Milvus Lite 方案，消除了文件锁冲突、额外进程管理等问题。
适用于中小规模（< 10万条 chunk）的知识库。

核心设计：
- embedding 存储在 Chunk.embedding 列（JSON 格式的 float 数组）
- 检索时全量查询已加载的 chunk → Python 计算余弦相似度 → 排序取 TopK
- 支持按 department_id / doc_id 过滤
"""

import asyncio
import logging
import math
from typing import List, Dict, Any, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)

# Embedding 向量维度（text-embedding-v3 输出 1024 维）
VECTOR_DIM = 1024


class VectorStore:
    """
    PostgreSQL 原生向量存储。

    不依赖任何外部向量数据库，直接通过 SQLAlchemy + Python 完成：
    1. 写入：存到 Chunk.embedding 列
    2. 检索：全量加载 → Python cosine → 排序取 TopK
    """

    def __init__(self):
        self._available = False
        self._chunk_cache: List[Dict[str, Any]] = []
        self._cache_version = 0
        logger.info("🗄️ VectorStore 初始化 | Backend: PostgreSQL (Python cosine)")

    @property
    def is_available(self) -> bool:
        return True  # PostgreSQL 始终可用

    async def connect(self) -> None:
        """建立连接（PostgreSQL 通过 SQLAlchemy 管理，无需额外连接）"""
        self._available = True
        logger.info("✅ VectorStore 已就绪 | 模式: PostgreSQL + Python cosine similarity")

    async def upsert_chunks(self, chunks: List[Dict[str, Any]]) -> int:
        """
        写入向量数据到 PostgreSQL Chunk 表的 embedding 列。
        注意：实际写入由 document_repo.save_chunks() 完成，
        此方法保留是为了兼容 knowledge_service 的旧调用路径。
        对于已在 document_tasks 中直接写入的 chunk，此方法返回 0（幂等）。
        """
        return 0  # 实际写入在 document_tasks.py 的 save_chunks 中完成

    async def search(
        self,
        query_embedding: List[float],
        top_k: int = 5,
        department_id: Optional[str] = None,
        doc_id: Optional[str] = None,
        ef_search: int = 128,  # 保留参数兼容性，不使用
    ) -> List[Dict[str, Any]]:
        """
        向量检索：从 PostgreSQL 加载所有 chunk → Python 计算余弦相似度 → 排序取 TopK。

        Args:
            query_embedding: 查询向量（1024维）
            top_k: 返回 Top-K 结果
            department_id: 按部门过滤
            doc_id: 按文档 ID 过滤

        Returns:
            [{"score": float, "content": str, "doc_id": str, "chunk_index": int, ...}]
        """
        from backend.core.database import async_session_factory
        from backend.models.db_models import Chunk
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        async with async_session_factory() as session:
            # 查询所有已加载 embedding 的 chunk
            conditions = [Chunk.embedding.isnot(None)]
            if department_id:
                # department_id 存储在 chunk_metadata 中
                conditions.append(Chunk.chunk_metadata["department_id"].as_string() == department_id)
            if doc_id:
                conditions.append(Chunk.document_id == doc_id)

            query = select(Chunk).where(*conditions)
            result = await session.execute(query)
            chunks = result.scalars().all()

        if not chunks:
            return []

        # 在 Python 中计算余弦相似度并排序
        scores = []
        for chunk in chunks:
            emb = chunk.embedding
            if not emb or len(emb) != VECTOR_DIM:
                continue
            sim = self._cosine_similarity(query_embedding, emb)
            scores.append((sim, chunk))

        # 按相似度降序排序
        scores.sort(key=lambda x: x[0], reverse=True)

        # 取 TopK
        top_hits = scores[:top_k]

        formatted = [
            {
                "score": round(score, 4),
                "content": chunk.content,
                "doc_id": chunk.document_id,
                "chunk_index": chunk.chunk_index,
                "department_id": (chunk.chunk_metadata or {}).get("department_id", ""),
                "header_path": (chunk.chunk_metadata or {}).get("header_path", ""),
            }
            for score, chunk in top_hits
        ]

        if formatted:
            logger.debug(
                f"[VectorStore] Search 完成 | TopK={top_k} | "
                f"Hits={len(formatted)} | TopScore={formatted[0]['score']:.4f}"
            )
        return formatted

    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        """计算两个向量的余弦相似度（值域 [-1, 1]）"""
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    async def delete_by_doc_id(self, doc_id: str) -> bool:
        """删除文档的所有 chunk（包括向量数据）—— 由 document_repo 处理关联删除"""
        return True

    async def close(self) -> None:
        """无需关闭（PostgreSQL 连接由 SQLAlchemy 管理）"""
        self._available = False
        logger.info("[VectorStore] 已关闭")


# 导出全局单例
vector_store = VectorStore()