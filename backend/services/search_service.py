# backend/services/search_service.py
import asyncio
import json
from typing import AsyncGenerator, List, Dict, Any
import logging

from backend.core.llm_client import llm_router
from backend.modules.rag_engine import rag_engine, RetrievedContext
from backend.core.security_gateway import security_gateway
from backend.core.config import settings
from backend.services.chat_service import citation_processor

logger = logging.getLogger(__name__)


class SearchService:
    """RAG 问答核心编排服务"""

    def __init__(self):
        self.max_context_tokens = settings.RAG_MAX_CONTEXT_TOKENS
        self.fallback_enabled = settings.RAG_FALLBACK_ENABLED

    async def ask_stream(
            self,
            query: str,
            user_id: str,
            session_id: str,
            department_id: str = "default_dept",
    ) -> AsyncGenerator[str, None]:
        """
        流式 RAG 问答主流程。
        遵循设计哲学：前置拦截 -> RAG 检索 -> 首包 Meta -> 流式生成 -> 事后审计。
        """
        logger.info(f"[SearchService] 用户 {user_id} 发起提问: {query[:50]}...")

        # Step 1: 前置安全拦截 — Prompt 注入检测
        injection_check = security_gateway.check_prompt_injection(query)
        if not injection_check[0]:
            yield f"data: {json.dumps({'type': 'error', 'content': '检测到不安全的输入，请修改后重试。'}, ensure_ascii=False)}\n\n"
            return

        # Step 2: RAG 检索
        retrieved: RetrievedContext = await self._retrieve_with_compensation(
            query, department_id
        )

        # Step 3: 首包下发 Meta（引用来源），前端可立即渲染引用卡片骨架
        if retrieved.sources:
            meta_event = json.dumps({
                "type": "meta",
                "citations": retrieved.sources,
            }, ensure_ascii=False)
            yield f"data: {meta_event}\n\n"

        # Step 4: 组装 System Prompt + 流式生成
        system_prompt = self._build_rag_prompt(query, retrieved.context_text)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": query},
        ]

        full_answer = ""
        try:
            async for chunk in llm_router.chat_completion_stream(messages=messages, temperature=0.3):
                full_answer += chunk
                # PII 脱敏后再 yield 给前端
                safe_chunk, _ = security_gateway.sanitize_pii(chunk)
                yield f"data: {json.dumps({'type': 'token', 'content': safe_chunk}, ensure_ascii=False)}\n\n"

            # 发送引用来源（经过防幻觉校验，仅保留 LLM 实际合法引用的来源）
            if retrieved.sources:
                validation = citation_processor.validate_and_clean(
                    full_answer,
                    valid_source_count=len(retrieved.sources),
                )
                if validation.invalid_citations:
                    logger.warning(
                        f"[SearchService] 检测到虚假引用并已剔除: {validation.invalid_citations} | "
                        f"合法来源数: {len(retrieved.sources)}"
                    )
                valid_sources = citation_processor.format_sources(
                    retrieved.sources,
                    validation.valid_citations,
                )
                sources_event = json.dumps({
                    "type": "sources",
                    "content": valid_sources,
                }, ensure_ascii=False)
                yield f"data: {sources_event}\n\n"

            yield f"data: {json.dumps({'type': 'done', 'content': ''})}\n\n"

        except Exception as e:
            logger.exception(f"[SearchService] LLM 流式生成中断: {e}")
            yield f"data: {json.dumps({'type': 'error', 'content': '抱歉，AI 思考过程遇到波动，请稍后重试。'}, ensure_ascii=False)}\n\n"

        # Step 5: 事后审计（异步，不阻塞响应）
        if full_answer:
            asyncio.create_task(self._post_audit(full_answer, user_id))

    async def _retrieve_with_compensation(self, query: str, department_id: str) -> RetrievedContext:
        """事务补偿机制：向量检索失败时，自动降级处理"""
        try:
            result = await asyncio.wait_for(
                rag_engine.retrieve(query=query, department_id=department_id),
                timeout=5.0,
            )
            return result
        except asyncio.TimeoutError:
            logger.warning("[SearchService] 向量检索超时，触发降级补偿策略")
        except Exception as e:
            logger.error(f"[SearchService] 向量检索异常: {e}，触发降级补偿策略")

        if self.fallback_enabled:
            return RetrievedContext(
                query=query,
                context_text="未检索到内部知识库相关信息，请基于你的通用知识回答，并在回复开头声明这是通用回答。",
                sources=[],
                hit_count=0,
            )
        return RetrievedContext(
            query=query,
            context_text="未从知识库中找到相关信息。",
            sources=[],
            hit_count=0,
        )

    def _build_rag_prompt(self, query: str, context_text: str) -> str:
        """构建 RAG 专属 System Prompt，严格限制幻觉"""
        return f"""你是一个专业的企业内部知识库 AI 助理。请严格基于以下【参考资料】回答用户的问题。

【重要规则】：
1. 如果【参考资料】中没有足够的信息，必须明确告知用户"知识库中未找到相关答案"，严禁编造（幻觉）。
2. 引用资料时请使用 [n] 标记，n 必须与参考资料中的编号一一对应，严禁捏造引用。
3. 逻辑清晰，使用 Markdown 格式（如列表、加粗）。
4. 保持客观、专业的企业级口吻。

【参考资料】:
{context_text}
"""

    async def _post_audit(self, answer: str, user_id: str) -> None:
        """事后合规审计（异步执行，不阻塞 SSE 流）"""
        try:
            _, pii_mapping = security_gateway.sanitize_pii(answer)
            if pii_mapping:
                logger.warning(
                    f"[SearchService] 事后审计发现 PII 泄露 | user={user_id} | "
                    f"PII 类型: {list(pii_mapping.keys())}"
                )
        except Exception as e:
            logger.error(f"[SearchService] 事后审计异常: {e}", exc_info=True)


# 实例化单例供路由层调用
search_service = SearchService()