"""文档异步处理 Celery 任务
将耗时较长的文档解析、分块、向量化等操作放入后台执行，避免阻塞 FastAPI worker。
"""

import os
import asyncio
import logging

from .celery_app import celery_app
import backend.core.database as db
from backend.repositories.document_repo import document_repo
from backend.models.db_models import DocumentStatus
from backend.services.knowledge_service import knowledge_service

logger = logging.getLogger(__name__)

# AI 自动分类提示词
CATEGORIZE_PROMPT = """你是一个文档分类助手。我会给你一个文档的文件名和内容摘要，请你根据文档的核心主题，生成一个简洁的中文分类名称。
规则：
1. 分类名称不超过8个字，使用中文，如"软件测试"、"项目管理"、"人力资源"、"财务报表"、"技术架构"等
2. 根据文档的实际主题内容命名，不要编造
3. 如果无法确定分类，输出"其他文档"
4. 直接返回分类名称，不要有任何标点符号、引号或额外说明

文件名：{filename}
内容摘要：
{summary}

分类名称："""


async def _ai_categorize_document(doc_id: str, filename: str, content: str) -> str:
    """使用 AI 根据文件名和内容自动确定文档分类"""
    try:
        from backend.core.llm_client import llm_router
        # 取前2000字作为摘要
        summary = content[:2000]
        prompt = CATEGORIZE_PROMPT.format(filename=filename, summary=summary)
        result = await llm_router.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        category = result.strip().strip('"').strip("'").strip("。").strip("！").strip(".").strip("？")
        if not category or len(category) > 20:
            return "其他文档"
        logger.info(f"[Task] AI 分类完成 | doc_id={doc_id} | category={category}")
        return category
    except Exception as e:
        logger.warning(f"[Task] AI 分类失败，使用默认分类 | doc_id={doc_id} | err={e}")
        return "其他文档"

# 上传文件的临时目录
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")

# celery beat 的调度入口（兼容性保留）
def auto_poll_unprocessed():
    """定时扫描未处理文档并分拆为独立任务——由 Celery Beat 调用"""
    logger.debug("[Beat] 执行未处理文档扫描（当前版本由上传接口直接 dispatch 任务，Beat 仅做兜底）")


async def _process_document_async(document_id: str, file_path: str, user_id: str):
    """实际的异步文档处理逻辑（解析+分块+向量化，直接存入 PostgreSQL）"""
    await _update_status(document_id, DocumentStatus.PROCESSING)

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"文件不存在: {file_path}")

    import asyncio as aio
    import time
    from pathlib import Path
    from backend.modules.document_parser import document_parser
    from backend.modules.text_splitter import text_splitter
    from backend.core.llm_client import llm_router

    path = Path(file_path)
    base_metadata = {
        "doc_id": document_id,
        "department_id": user_id,
        "filename": path.name,
    }

    # === Step 1: 文档解析（CPU 密集，放入线程池） ===
    parsed = await aio.to_thread(document_parser.parse, str(path), document_id)

    if parsed.parse_status == "failed":
        raise RuntimeError(parsed.error_msg or "文档解析失败")

    if not parsed.full_text.strip():
        raise RuntimeError("解析结果为空，可能为扫描版无文字PDF或加密文档")

    # === Step 1.5: AI 自动分类（根据文件名+内容摘要） ===
    category = await _ai_categorize_document(document_id, path.name, parsed.full_text)
    async with db.async_session_factory() as s:
        await document_repo.update_category(s, document_id, category)
        await s.commit()
    logger.info(f"[Task] 文档分类已更新 | doc_id={document_id} | category={category}")

    # === Step 2: 语义分块 ===
    text_chunks = text_splitter.split_document(
        text=parsed.full_text,
        base_metadata=base_metadata,
    )

    if not text_chunks:
        raise RuntimeError("分块结果为空，文档内容可能过短或格式异常")

    # === Step 3: 向量化 ===
    chunk_texts = [c.content for c in text_chunks]
    embeddings = await llm_router.get_embeddings(chunk_texts)

    # === Step 4: 保存分块到 PostgreSQL（含 embedding 直接存入 Chunk.embedding 列） ===
    chunk_dicts = []
    for i, chunk in enumerate(text_chunks):
        header_path = (
            chunk.metadata.get("header_path", "")
            or chunk.metadata.get("header_1", "")
            or chunk.metadata.get("header_2", "")
        )
        chunk_dicts.append({
            "chunk_index": chunk.metadata.get("chunk_index", i),
            "content": chunk.content,
            "embedding": embeddings[i],
            "metadata": {
                "header_path": header_path,
                "department_id": user_id,
            },
        })

    async with db.async_session_factory() as session:
        await document_repo.save_chunks(session, document_id, chunk_dicts)
        await session.commit()

    logger.info(f"[Task] 文档 {document_id} 处理完成 | 分块: {len(chunk_dicts)}")
    await _update_status(document_id, DocumentStatus.COMPLETED)
    return {"status": "COMPLETED", "document_id": document_id, "chunk_count": len(chunk_dicts)}


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_document(self, document_id: str, file_path: str, user_id: str):
    """
    处理单个知识库文档:
    1. 读取原始文件
    2. 解析为 Markdown/纯文本
    3. 分块 (chunk)
    4. 向量化 + 写入 PostgreSQL
    5. 更新数据库状态
    6. 清理临时文件
    """
    logger.info(f"[Task] 开始处理文档 {document_id}, 文件路径: {file_path}")

    async def _run_in_task_loop():
        """在独立的事件循环中初始化数据库连接并执行文档处理"""
        from backend.core.database import create_engine, _init_factory, get_db_type

        # 为当前任务创建独立的数据库引擎（绑定到当前事件循环）
        task_engine = create_engine()
        import backend.core.database as db_module
        db_module.engine = task_engine
        db_module._db_type = get_db_type()
        db_module.async_session_factory = None  # 强制重建，确保绑定到当前引擎
        _init_factory()

        try:
            result = await _process_document_async(document_id, file_path, user_id)
            return result
        finally:
            await task_engine.dispose()

    try:
        result = asyncio.run(_run_in_task_loop())
        # 成功后清理临时文件
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.debug(f"[Task] 已清理临时文件: {file_path}")
        except OSError:
            pass
        return result

    except Exception as e:
        error_msg = str(e)
        logger.error(f"[Task] 文档 {document_id} 处理失败: {error_msg}")

        async def _update_failed_status():
            from backend.core.database import create_engine, _init_factory, get_db_type
            task_engine = create_engine()
            import backend.core.database as db_module
            db_module.engine = task_engine
            db_module._db_type = get_db_type()
            db_module.async_session_factory = None
            _init_factory()
            try:
                await _update_status(document_id, DocumentStatus.FAILED, error_msg=error_msg)
            finally:
                await task_engine.dispose()

        try:
            asyncio.run(_update_failed_status())
        except Exception as db_err:
            logger.error(f"[Task] 更新失败状态时数据库出错: {db_err}")

        # 失败后也清理临时文件（避免磁盘堆积）
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.debug(f"[Task] 处理失败，已清理临时文件: {file_path}")
        except OSError:
            pass

        # 只有非文件不存在错误才重试
        if "文件不存在" in error_msg or "FileNotFound" in error_msg or "No such file" in error_msg:
            logger.warning(f"[Task] 文件不存在，不再重试 | doc_id={document_id}")
            return {"status": "FAILED", "document_id": document_id, "error": error_msg}

        raise self.retry(exc=e)


async def _update_status(
    document_id: str,
    status: DocumentStatus,
    error_msg: str = "",
):
    """在异步数据库会话中更新文档状态"""
    async with db.async_session_factory() as session:
        await document_repo.update_status(
            session,
            doc_id=document_id,
            status=status,
            error_msg=error_msg or None,
        )
        await session.commit()