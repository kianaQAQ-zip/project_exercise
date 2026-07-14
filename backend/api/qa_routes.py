# backend/api/qa_routes.py
import json
import logging
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import AsyncGenerator, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.schemas import (
    AskRequest, ConversationItem, ConversationCreateRequest,
    ConversationTitleRequest, ConversationTitleGenerateRequest, APIResponse,
)
from backend.core.security_gateway import security_gateway
from backend.core.database import get_db
from backend.repositories.conversation_repo import conversation_repo
from backend.api.deps import get_current_active_user

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/ask/stream", summary="Agent 流式问答")
async def ask_question(request: AskRequest):
    """
    SSE 流式问答接口（基于 LangGraph Agent）。
    Agent 具备工具调用能力：知识库检索、Web 搜索、邮件发送。
    Agent 会自动调用 search_knowledge_base 工具检索企业内部知识库，
    无需在用户消息中预注入上下文。
    数据格式: data: {"type": "token|sources|done|error", "content": "..."}\n\n
    """
    from backend.core.agent_engine import get_agent_engine

    is_safe, reason = security_gateway.check_prompt_injection(request.query)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"输入包含不安全内容: {reason}")

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async for event_type, data in get_agent_engine().astream(
                user_message=request.query,
                session_id=request.session_id,
            ):
                if event_type == "sources":
                    yield f"data: {json.dumps({'type': 'sources', 'content': data.get('citations', [])}, ensure_ascii=False)}\n\n"
                elif event_type == "done":
                    pass
                else:
                    yield f"data: {json.dumps({'type': event_type, 'content': data.get('content', '')}, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'content': ''})}\n\n"

        except ValueError as e:
            error_msg = json.dumps({"type": "error", "content": str(e)}, ensure_ascii=False)
            yield f"data: {error_msg}\n\n"
        except Exception as e:
            logger.error(f"[QA API] Agent 流式生成异常: {e}", exc_info=True)
            error_msg = json.dumps({"type": "error", "content": "系统繁忙，请稍后重试"}, ensure_ascii=False)
            yield f"data: {error_msg}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/ask", summary="Agent 非流式问答")
async def ask_question_simple(request: AskRequest):
    """
    非流式问答接口（一次性返回完整回答）。
    适用于不支持 SSE 的客户端或简单场景。
    """
    from backend.core.agent_engine import get_agent_engine

    is_safe, reason = security_gateway.check_prompt_injection(request.query)
    if not is_safe:
        raise HTTPException(status_code=400, detail=f"输入包含不安全内容: {reason}")

    try:
        answer = await get_agent_engine().ainvoke(
            user_message=request.query,
            session_id=request.session_id,
        )
        return {"answer": answer, "session_id": request.session_id}
    except Exception as e:
        logger.error(f"[QA API] Agent 调用失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="AI 服务暂时不可用")


@router.get("/history/{session_id}", summary="获取会话历史")
async def get_chat_history(session_id: str, limit: int = 50):
    """获取指定会话的历史聊天记录"""
    from backend.core.agent_engine import get_agent_engine

    try:
        engine = get_agent_engine()
        await engine._ensure_initialized()
        checkpointer = engine.agent.checkpointer
        assert checkpointer is not None, "Checkpointer is not initialized"
        config = engine.build_config(session_id)
        state = await checkpointer.aget(config)

        if state and "channel_values" in state:
            channel_values = state["channel_values"]
            if "messages" in channel_values:
                all_messages = channel_values["messages"]
                # 过滤掉工具消息，只保留人类和AI消息
                filtered = []
                for msg in all_messages:
                    msg_type = msg.type if hasattr(msg, "type") else getattr(msg, "type", None)
                    if msg_type == "tool":
                        continue
                    if msg_type in ("human", "ai"):
                        filtered.append({"role": msg_type, "content": msg.content})
                return filtered[-limit:]
        return []
    except Exception as e:
        logger.error(f"[QA API] 获取历史记录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取历史记录失败")


# ================= 对话记录管理 =================

@router.get("/conversations", summary="获取对话记录列表")
async def list_conversations(
        current_user=Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
):
    """获取当前用户的所有对话记录，星标置顶、按更新时间倒序"""
    try:
        convs = await conversation_repo.list_by_user(db, current_user.id)
        return APIResponse(
            code=200,
            data=[ConversationItem.model_validate(c) for c in convs],
            message="success",
        )
    except Exception as e:
        logger.error(f"[QA API] 获取对话列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取对话列表失败")


@router.post("/conversations", summary="创建新对话记录")
async def create_conversation(
        request: ConversationCreateRequest,
        current_user=Depends(get_current_active_user),
        db: AsyncSession = Depends(get_db),
):
    """创建新对话记录，自动清理超过 8 条的非星标旧对话"""
    try:
        existing = await conversation_repo.get_by_session_id(db, request.session_id)
        if existing:
            return APIResponse(
                code=200,
                data=ConversationItem.model_validate(existing),
                message="对话已存在",
            )
        conv = await conversation_repo.create(db, request.session_id, current_user.id, request.title)
        return APIResponse(
            code=201,
            data=ConversationItem.model_validate(conv),
            message="创建成功",
        )
    except Exception as e:
        logger.error(f"[QA API] 创建对话失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="创建对话失败")


@router.put("/conversations/{session_id}/title", summary="更新对话标题")
async def update_conversation_title(
        session_id: str,
        request: ConversationTitleRequest,
        db: AsyncSession = Depends(get_db),
):
    """手动更新对话标题"""
    try:
        ok = await conversation_repo.update_title(db, session_id, request.title)
        if not ok:
            raise HTTPException(status_code=404, detail="对话不存在")
        return APIResponse(message="标题已更新")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[QA API] 更新标题失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="更新标题失败")


@router.post("/conversations/title/generate", summary="AI 自动生成对话标题")
async def generate_conversation_title(
        request: ConversationTitleGenerateRequest,
        db: AsyncSession = Depends(get_db),
):
    """根据用户的第一条消息，使用 LLM 自动生成简洁的对话标题"""
    from backend.core.llm_client import llm_router

    # 默认使用用户消息的前20个字符作为兜底标题
    fallback_title = request.user_message[:20].strip()
    if len(request.user_message) > 20:
        fallback_title += "..."

    try:
        prompt = (
            f"为以下用户消息生成一个简洁的对话标题（不超过15个字），直接返回标题文本，不要任何标点符号、引号或额外说明：\n\n"
            f"用户消息：{request.user_message[:300]}"
        )
        result = await llm_router.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        title = result.strip().strip('"').strip("'").strip("。").strip("！").strip(".").strip("？").strip("，")
        if not title or len(title) > 30:
            title = fallback_title

        await conversation_repo.update_title(db, request.session_id, title)
        return APIResponse(code=200, data={"title": title}, message="标题已生成")
    except Exception as e:
        logger.error(f"[QA API] 生成标题失败，使用兜底标题: {e}")
        # 即使 LLM 调用失败，也使用兜底标题更新
        try:
            await conversation_repo.update_title(db, request.session_id, fallback_title)
            return APIResponse(code=200, data={"title": fallback_title}, message="标题已生成")
        except Exception as db_err:
            logger.error(f"[QA API] 更新兜底标题也失败: {db_err}")
            raise HTTPException(status_code=500, detail="生成标题失败")


@router.put("/conversations/{session_id}/star", summary="切换对话星标状态")
async def toggle_conversation_star(
        session_id: str,
        db: AsyncSession = Depends(get_db),
):
    """切换对话的星标状态（标记/取消重点记录）"""
    try:
        conv = await conversation_repo.toggle_star(db, session_id)
        if not conv:
            raise HTTPException(status_code=404, detail="对话不存在")
        return APIResponse(
            code=200,
            data={"starred": conv.starred},
            message="已设为星标" if conv.starred else "已取消星标",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[QA API] 切换星标失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="切换星标失败")


@router.delete("/conversations/{session_id}", summary="删除对话记录")
async def delete_conversation(
        session_id: str,
        db: AsyncSession = Depends(get_db),
):
    """删除对话记录（不会删除 LangGraph 的 checkpoint 数据）"""
    try:
        ok = await conversation_repo.delete(db, session_id)
        if not ok:
            raise HTTPException(status_code=404, detail="对话不存在")
        return APIResponse(message="对话已删除")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[QA API] 删除对话失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="删除对话失败")
