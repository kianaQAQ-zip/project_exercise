# backend/api/knowledge_routes.py

import logging
from pathlib import Path
from uuid import uuid4
from typing import Optional

from pydantic import BaseModel
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from backend.models.schemas import (
    APIResponse,
    PaginatedResponse,
    DocumentDetailResponse,
    DocumentUploadResponse,
)
from backend.repositories.document_repo import document_repo
from backend.core.database import get_db
from backend.models.db_models import Document, DocumentStatus
from backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/upload", response_model=APIResponse[DocumentUploadResponse], summary="上传文档至知识库")
async def upload_document(
    file: UploadFile = File(...),
    department_id: str = Form("default_dept"),
    category: Optional[str] = Form(None, description="文档分类，如'软件测试'、'项目管理'"),
    db: AsyncSession = Depends(get_db),
):
    """
    接收文件并触发异步解析任务。
    立即返回 202 Accepted，不等待解析完成。
    """
    allowed_extensions = ('.pdf', '.docx', '.doc', '.xlsx', '.xls', '.md', '.txt')
    if not file.filename or not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(status_code=400, detail=f"不支持的文件格式，仅允许 {allowed_extensions}")

    try:
        content = await file.read()

        import hashlib
        file_hash = hashlib.sha256(content).hexdigest()

        existing = await document_repo.get_by_file_hash(db, file_hash)
        if existing:
            logger.info(f"[Knowledge API] 文件已存在，跳过上传 | doc_id={existing.id} | filename={existing.filename}")
            return APIResponse(
                code=200,
                message="文件已存在，无需重复上传",
                data=DocumentUploadResponse(
                    document_id=existing.id,
                    filename=existing.filename,
                    status=existing.status.value if hasattr(existing.status, 'value') else str(existing.status),
                    category=existing.category,
                )
            )

        doc_id = uuid4().hex

        # 保存文档元数据到数据库
        doc = Document(
            id=doc_id,
            filename=file.filename,
            file_hash=file_hash,
            file_size=len(content),
            mime_type=file.content_type or "application/octet-stream",
            status=DocumentStatus.PENDING,
            user_id=department_id,
            category=category,
        )
        db.add(doc)
        await db.commit()
        await db.refresh(doc)

        # 保存文件到临时目录（使用绝对路径）
        safe_name = f"{doc_id}{Path(file.filename).suffix.lower()}"
        temp_dir = Path(settings.TEMP_UPLOAD_DIR).resolve()
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp_path = temp_dir / safe_name

        with open(temp_path, "wb") as f:
            f.write(content)

        # 使用后台线程同步处理文档
        import threading
        def _sync_process():
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            _file_path = str(temp_path)
            try:
                from backend.tasks.document_tasks import _process_document_async, _update_status
                from backend.core.database import create_engine, _init_factory, get_db_type
                task_engine = create_engine()
                import backend.core.database as db_module
                db_module.engine = task_engine
                db_module._db_type = get_db_type()
                db_module.async_session_factory = None
                _init_factory()
                try:
                    loop.run_until_complete(_process_document_async(doc_id, _file_path, department_id))
                finally:
                    loop.run_until_complete(task_engine.dispose())
                try:
                    if Path(_file_path).exists():
                        Path(_file_path).unlink()
                except OSError:
                    pass
            except Exception as e:
                logger.error(f"[Knowledge API] 同步处理文档失败 | doc_id={doc_id} | err={e}")
                try:
                    if Path(_file_path).exists():
                        Path(_file_path).unlink()
                except OSError:
                    pass
            finally:
                loop.close()
        threading.Thread(target=_sync_process, daemon=True).start()
        logger.info(f"[Knowledge API] 已启动后台处理线程 | doc_id={doc_id}")

        logger.info(f"[Knowledge API] 文件已接收 | doc_id={doc_id} | filename={file.filename}")

        return APIResponse(
            code=202,
            message="文件已接收，正在后台异步解析中...",
            data=DocumentUploadResponse(
                document_id=doc_id,
                filename=file.filename,
                status="PENDING",
                category=category,
            )
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Knowledge API] 文件上传失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="文件上传失败，请稍后重试")

@router.get("/list", summary="获取文档列表")
async def list_documents(
    department_id: str = "default_dept",
    page: int = 1,
    page_size: int = 20,
    category: Optional[str] = Query(None, description="按分类筛选"),
    db: AsyncSession = Depends(get_db),
):
    """分页获取当前部门的文档列表，支持按分类筛选"""
    try:
        skip = (page - 1) * page_size
        items, total = await document_repo.list_by_user(
            db, user_id=department_id, skip=skip, limit=page_size, category=category,
        )
        return PaginatedResponse(
            data=[DocumentDetailResponse.model_validate(doc) for doc in items],
            total=total,
        )
    except Exception as e:
        logger.error(f"[Knowledge API] 获取文档列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取文档列表失败")

@router.get("/categories", summary="获取所有文档分类")
async def list_categories(
    department_id: str = "default_dept",
    db: AsyncSession = Depends(get_db),
):
    """获取当前部门下所有已有的文档分类列表"""
    try:
        categories = await document_repo.list_categories(db, user_id=department_id)
        return APIResponse(code=200, data=categories, message="success")
    except Exception as e:
        logger.error(f"[Knowledge API] 获取分类列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取分类列表失败")

@router.get("/verify/{doc_id}", summary="验证文档处理状态")
async def verify_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
):
    """验证文档是否已成功处理并入库，返回详细的处理状态"""
    try:
        doc = await document_repo.get_with_chunks(db, doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail=f"文档 {doc_id} 不存在")

        chunk_count = len(doc.chunks) if doc.chunks else 0
        embedding_count = sum(1 for c in (doc.chunks or []) if c.embedding is not None)

        # 向量是否已内嵌到 PG
        vector_ok = embedding_count > 0

        return APIResponse(code=200, data={
            "doc_id": doc_id,
            "filename": doc.filename,
            "status": doc.status.value if hasattr(doc.status, 'value') else str(doc.status),
            "category": doc.category,
            "chunk_count": chunk_count,
            "vector_embedded": embedding_count,
            "vector_ok": vector_ok,
            "error_msg": doc.error_msg,
            "pipeline_healthy": doc.status == DocumentStatus.COMPLETED and chunk_count > 0,
        }, message="success")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Knowledge API] 验证文档 {doc_id} 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="验证文档失败")

@router.get("/pending-count", summary="获取待处理文档数量")
async def get_pending_count(
    department_id: str = Query("default_dept", description="部门 ID"),
    db: AsyncSession = Depends(get_db),
):
    """获取状态为 PENDING 或 PROCESSING 的文档数量，用于前端通知徽章"""
    try:
        items, _ = await document_repo.list_by_user(
            db, user_id=department_id, skip=0, limit=200,
        )
        pending = sum(1 for d in items if d.status in (DocumentStatus.PENDING, DocumentStatus.PROCESSING))
        return APIResponse(code=200, data={"count": pending}, message="success")
    except Exception as e:
        logger.error(f"[Knowledge API] 获取待处理文档数量失败: {e}", exc_info=True)
        return APIResponse(code=200, data={"count": 0}, message="success")

class UpdateDocumentRequest(BaseModel):
    """文档更新请求体"""
    category: Optional[str] = None

@router.patch("/{doc_id}", summary="更新文档信息（如分类）")
async def update_document(
    doc_id: str,
    body: UpdateDocumentRequest,
    db: AsyncSession = Depends(get_db),
):
    """更新文档的元数据，例如修改分类"""
    try:
        from sqlalchemy import update
        stmt = update(Document).where(Document.id == doc_id)
        values = {}
        if body.category is not None:
            values["category"] = body.category
        if not values:
            raise HTTPException(status_code=400, detail="没有可更新的字段")
        result = await db.execute(stmt.values(**values))
        await db.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"文档 {doc_id} 不存在")
        return APIResponse(code=200, data={"doc_id": doc_id, **values}, message="更新成功")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Knowledge API] 更新文档 {doc_id} 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="更新文档失败")

@router.delete("/{doc_id}", summary="删除文档及关联向量")
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
):
    """删除 PG 中的文档记录（CASCADE 删除关联 chunks）"""
    try:
        deleted = await document_repo.delete(db, doc_id)
        if not deleted:
            raise ValueError(f"文档 {doc_id} 不存在")
        return APIResponse(code=200, message=f"文档 {doc_id} 及其关联向量已删除")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[Knowledge API] 删除文档 {doc_id} 失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="删除文档失败")