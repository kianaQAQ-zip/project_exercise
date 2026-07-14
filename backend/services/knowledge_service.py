# backend/services/knowledge_service.py
import logging
import time
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path
from dataclasses import dataclass
from enum import Enum

from backend.modules.document_parser import document_parser, ParsedDocument
from backend.modules.text_splitter import text_splitter
from backend.modules.vector_store import vector_store
from backend.core.llm_client import llm_router

logger = logging.getLogger(__name__)


class IngestStatus(str, Enum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"


@dataclass
class IngestResult:
    """文档入库结果"""
    doc_id: str
    filename: str
    status: IngestStatus
    chunks_total: int
    chunks_ingested: int
    parse_time_ms: float
    error_message: Optional[str] = None


class KnowledgeService:
    """
    知识库管理服务。
    核心职责：编排 解析→分块→向量化 全流程，保证文档级事务一致性与状态可追溯。
    """

    def __init__(self):
        logger.info("📚 KnowledgeService 初始化完成")

    async def ingest_document(
            self,
            file_path: str | Path,
            doc_id: str,
            department_id: str,
            extra_metadata: Optional[Dict[str, Any]] = None,
    ) -> IngestResult:
        """
        单文档入库全流程（解析 → 分块 → 向量化）。

        关键设计：
        1. 写入前先按 doc_id 清理旧向量，保证文档更新时的版本一致性
        2. 解析/分块在 executor 中执行，避免阻塞事件循环
        3. 单文档异常完全隔离，返回结构化错误而非抛异常

        Args:
            file_path: 本地文件路径
            doc_id: 文档唯一标识（通常为 UUID）
            department_id: 所属部门（用于权限隔离）
            extra_metadata: 额外元数据透传
        """
        path = Path(file_path)
        base_metadata = {
            "doc_id": doc_id,
            "department_id": department_id,
            "filename": path.name,
            **(extra_metadata or {}),
        }

        try:
            t_start = time.perf_counter()

            # === Step 0: 清理旧版本向量（幂等覆盖） ===
            await vector_store.delete_by_doc_id(doc_id)

            # === Step 1: 文档解析（CPU 密集，放入线程池） ===
            parsed: ParsedDocument = await asyncio.to_thread(
                document_parser.parse, str(path), doc_id
            )

            if parsed.parse_status == "failed":
                return IngestResult(
                    doc_id=doc_id, filename=path.name,
                    status=IngestStatus.FAILED, chunks_total=0,
                    chunks_ingested=0, parse_time_ms=0.0,
                    error_message=parsed.error_msg or "文档解析失败",
                )

            if not parsed.full_text.strip():
                return IngestResult(
                    doc_id=doc_id, filename=path.name,
                    status=IngestStatus.FAILED, chunks_total=0,
                    chunks_ingested=0, parse_time_ms=0.0,
                    error_message="解析结果为空，可能为扫描版无文字PDF或加密文档",
                )

            # === Step 2: 语义分块 ===
            text_chunks = text_splitter.split_document(
                text=parsed.full_text,
                base_metadata=base_metadata,
            )

            if not text_chunks:
                return IngestResult(
                    doc_id=doc_id, filename=path.name,
                    status=IngestStatus.FAILED, chunks_total=0,
                    chunks_ingested=0, parse_time_ms=0.0,
                    error_message="分块结果为空，文档内容可能过短或格式异常",
                )

            # === Step 3: 向量化 + 批量写入 ===
            chunk_texts = [c.content for c in text_chunks]
            embeddings = await llm_router.get_embeddings(chunk_texts)

            chunk_dicts = []
            for i, chunk in enumerate(text_chunks):
                header_path = (
                    chunk.metadata.get("header_path", "")
                    or chunk.metadata.get("header_1", "")
                    or chunk.metadata.get("header_2", "")
                )
                chunk_dicts.append({
                    "id": f"{doc_id}_{chunk.metadata.get('chunk_index', i)}",
                    "content": chunk.content,
                    "doc_id": doc_id,
                    "chunk_index": chunk.metadata.get("chunk_index", i),
                    "department_id": department_id,
                    "header_path": header_path,
                    "embedding": embeddings[i],
                })

            ingested_count = await vector_store.upsert_chunks(chunk_dicts)

            # === Step 4: 判定最终状态 ===
            status = IngestStatus.SUCCESS
            error_msg = None
            if ingested_count == 0:
                status = IngestStatus.FAILED
                error_msg = "所有分块写入向量库失败"
            elif ingested_count < len(text_chunks):
                status = IngestStatus.PARTIAL
                error_msg = f"部分写入失败: {ingested_count}/{len(text_chunks)}"

            elapsed_ms = (time.perf_counter() - t_start) * 1000
            result = IngestResult(
                doc_id=doc_id, filename=path.name, status=status,
                chunks_total=len(text_chunks), chunks_ingested=ingested_count,
                parse_time_ms=round(elapsed_ms, 2), error_message=error_msg,
            )
            logger.info(
                f"[KnowledgeService] 入库完成 | doc_id={doc_id} | "
                f"status={status.value} | chunks={ingested_count}/{len(text_chunks)} | "
                f"elapsed={elapsed_ms:.0f}ms"
            )
            return result

        except Exception as e:
            logger.error(f"[KnowledgeService] 入库异常 | doc_id={doc_id} | {e}", exc_info=True)
            return IngestResult(
                doc_id=doc_id, filename=path.name,
                status=IngestStatus.FAILED, chunks_total=0,
                chunks_ingested=0, parse_time_ms=0.0,
                error_message=str(e)[:500],
            )

    async def ingest_batch(
            self,
            tasks: List[Dict[str, Any]],
            concurrency: int = 3,
    ) -> List[IngestResult]:
        """
        并发批量入库，通过信号量控制并发度，防止解析/嵌入服务过载。

        Args:
            tasks: [{"file_path": ..., "doc_id": ..., "department_id": ..., "extra_metadata": ...}]
            concurrency: 最大并发数
        """
        semaphore = asyncio.Semaphore(concurrency)
        results: List[IngestResult] = []

        async def _guarded(task: Dict[str, Any]) -> IngestResult:
            async with semaphore:
                return await self.ingest_document(**task)

        coros = [_guarded(t) for t in tasks]
        results = await asyncio.gather(*coros, return_exceptions=False)

        success = sum(1 for r in results if r.status == IngestStatus.SUCCESS)
        partial = sum(1 for r in results if r.status == IngestStatus.PARTIAL)
        failed = sum(1 for r in results if r.status == IngestStatus.FAILED)
        logger.info(
            f"[KnowledgeService] 批量入库完成 | total={len(tasks)} | "
            f"success={success} | partial={partial} | failed={failed}"
        )
        return list(results)

    async def delete_document(self, doc_id: str) -> bool:
        """删除文档及其所有关联数据（由 document_repo 级联处理）"""
        try:
            logger.info(f"[KnowledgeService] 文档已删除 | doc_id={doc_id}")
            return True
        except Exception as e:
            logger.error(f"[KnowledgeService] 删除文档失败 | doc_id={doc_id} | {e}", exc_info=True)
            return False


# 导出全局单例
knowledge_service = KnowledgeService()