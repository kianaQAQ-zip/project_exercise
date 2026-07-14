# backend/modules/rag_engine.py
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from backend.core.config import settings
from backend.core.llm_client import llm_router
from backend.modules.vector_store import vector_store

logger = logging.getLogger(__name__)


@dataclass
class RetrievedContext:
    """标准化的 RAG 检索结果"""
    query: str  # 原始/改写后的查询
    context_text: str  # 组装好的带引用标记的上下文
    sources: List[Dict[str, Any]]  # 结构化来源列表（供前端渲染引用卡片）
    hit_count: int  # 有效命中数


class RAGEngine:
    """
    企业级 RAG 检索引擎。
    核心流程：Query Rewrite -> Vector Search -> Rerank -> Context Assembly
    """

    # 引用标记模板，与 LLM System Prompt 中的引用规范严格对齐
    CITE_TEMPLATE = "[{index}]"
    CONTEXT_HEADER = "以下是从企业知识库中检索到的相关信息，请基于这些信息回答问题。每条信息末尾的 [n] 为引用标记：\n\n"

    def __init__(self):
        self.top_k = settings.RAG_TOP_K
        self.rerank_top_n = settings.RAG_RERANK_TOP_N
        self.score_threshold = settings.RAG_SCORE_THRESHOLD
        logger.info(
            f"🧠 RAGEngine 初始化 | top_k={self.top_k} | "
            f"rerank_top_n={self.rerank_top_n} | threshold={self.score_threshold}"
        )

    async def rewrite_query(self, original_query: str, chat_history: Optional[List[Dict]] = None) -> str:
        """
        查询改写：结合多轮对话历史，将指代不清或模糊的用户问题改写为独立、精确的检索查询。
        若无需改写则返回原文，避免不必要的 LLM 调用开销。
        """
        if not chat_history or len(chat_history) < 2:
            return original_query

        prompt = (
            "你是一个查询改写助手。根据对话历史，将用户的最新问题改写为一个独立、完整、适合知识库检索的查询。\n"
            "如果问题已经足够清晰，直接返回原问题。\n"
            "仅输出改写后的查询，不要任何解释。\n\n"
            f"对话历史:\n{self._format_history(chat_history)}\n\n"
            f"最新问题: {original_query}\n\n"
            "改写后的查询:"
        )

        try:
            rewritten = await llm_router.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
            )
            rewritten = rewritten.strip()
            if rewritten and rewritten != original_query:
                logger.info(f"[RAGEngine] Query改写 | '{original_query}' -> '{rewritten}'")
                return rewritten
        except Exception as e:
            logger.warning(f"[RAGEngine] Query改写失败，使用原始查询: {e}")

        return original_query

    async def retrieve(
            self,
            query: str,
            department_id: Optional[str] = None,
            doc_id: Optional[str] = None,
            chat_history: Optional[List[Dict]] = None,
    ) -> RetrievedContext:
        """
        统一检索入口：改写 -> 检索 -> 过滤 -> 组装。

        Args:
            query: 用户原始问题
            department_id: 部门权限隔离
            doc_id: 指定文档内检索
            chat_history: 多轮对话历史

        Returns:
            RetrievedContext 包含组装好的上下文和结构化来源
        """
        # Step 1: 查询改写
        effective_query = await self.rewrite_query(query, chat_history)

        query_embedding = await llm_router.get_embeddings([effective_query])
        raw_hits = await vector_store.search(
            query_embedding=query_embedding[0],
            top_k=self.top_k,
            department_id=department_id,
            doc_id=doc_id,
        )

        # Step 3: 分数阈值过滤
        filtered_hits = [h for h in raw_hits if h["score"] >= self.score_threshold]
        if not filtered_hits:
            logger.info(f"[RAGEngine] 无有效命中 | query='{effective_query}' | threshold={self.score_threshold}")
            return RetrievedContext(
                query=effective_query,
                context_text="未从知识库中找到相关信息。",
                sources=[],
                hit_count=0,
            )

        # Step 4: 取 Top-N（预留 Rerank 位置，当前按向量分数截断）
        final_hits = filtered_hits[: self.rerank_top_n]

        # Step 5: 组装带引用的上下文
        context_text, sources = self._assemble_context(final_hits)

        logger.info(
            f"[RAGEngine] 检索完成 | query='{effective_query}' | "
            f"raw={len(raw_hits)} | filtered={len(filtered_hits)} | final={len(final_hits)}"
        )

        return RetrievedContext(
            query=effective_query,
            context_text=context_text,
            sources=sources,
            hit_count=len(final_hits),
        )

    def _assemble_context(self, hits: List[Dict[str, Any]]) -> tuple[str, List[Dict[str, Any]]]:
        """
        将检索结果组装为带 [n] 引用标记的上下文文本。
        引用标记与 sources 列表索引一一对应，确保 LLM 输出可溯源。
        """
        context_parts = []
        sources = []

        for idx, hit in enumerate(hits, start=1):
            cite_tag = self.CITE_TEMPLATE.format(index=idx)
            chunk_content = hit["content"].strip()
            context_parts.append(f"{chunk_content} {cite_tag}")

            sources.append({
                "ref_index": idx,
                "doc_id": hit.get("doc_id", ""),
                "chunk_index": hit.get("chunk_index", 0),
                "department_id": hit.get("department_id", ""),
                "header_path": hit.get("header_path", ""),
                "score": round(hit.get("score", 0.0), 4),
                "snippet": chunk_content[:200] + ("..." if len(chunk_content) > 200 else ""),
            })

        full_context = self.CONTEXT_HEADER + "\n\n".join(context_parts)
        return full_context, sources

    @staticmethod
    def _format_history(history: List[Dict]) -> str:
        """格式化对话历史用于 Prompt 注入"""
        lines = []
        for msg in history[-6:]:  # 仅保留最近 3 轮，避免 token 溢出
            role = "用户" if msg.get("role") == "user" else "助手"
            lines.append(f"{role}: {msg.get('content', '')[:300]}")
        return "\n".join(lines)


# 导出全局单例
rag_engine = RAGEngine()