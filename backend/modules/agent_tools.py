# backend/modules/agent_tools.py
"""
LangGraph Agent 企业工具集。

将现有企业模块（RAG 检索、邮件收发、Web 搜索）封装为 LangChain @tool，
供 Agent 在推理过程中按需调用。

⚠️ 铁律：
- 每个工具必须是独立的、幂等的、有明确错误处理的
- 工具的 docstring 是 Agent 理解该工具用途的唯一依据，必须精确
- 禁止在工具内直接调用 LLM（避免递归调用）
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from langchain_core.tools import tool

from backend.core.config import settings

logger = logging.getLogger(__name__)


@tool
async def search_knowledge_base(query: str, department_id: str = "default_dept") -> str:
    """
    在企业内部知识库中搜索信息。这是你回答任何问题的第一步，必须最先调用！
    无论用户问什么（公司制度、流程、规范、产品文档、项目信息等），都必须先调用此工具。
    只有在返回"知识库中未找到相关信息"后，才能使用其他工具或自身知识。
    如果搜索不到结果，请如实告知用户"知识库中未找到相关信息"。

    Args:
        query: 搜索查询关键词，应尽量具体
        department_id: 部门ID，用于权限隔离，默认 "default_dept"

    Returns:
        知识库检索结果，包含相关内容片段和来源引用
    """
    try:
        from backend.modules.rag_engine import rag_engine

        result = await rag_engine.retrieve(query=query, department_id=department_id)

        if result.hit_count == 0:
            return "知识库中未找到与该查询相关的信息。"

        output_parts = [f"知识库检索结果（共 {result.hit_count} 条）：\n"]
        for source in result.sources:
            output_parts.append(
                f"[{source['ref_index']}] (来源: {source['doc_id']}, "
                f"相关度: {source['score']:.2f})\n{source['snippet']}\n"
            )
        output_parts.append(f"\n完整上下文:\n{result.context_text}")
        return "\n".join(output_parts)

    except Exception as e:
        logger.error(f"[Tool:search_knowledge_base] 检索失败: {e}", exc_info=True)
        return f"知识库检索失败: {str(e)[:200]}"


@tool
async def search_web(query: str) -> str:
    """
    在互联网上搜索公开信息。
    当用户的问题涉及企业内部知识库以外的公开信息时使用（如新闻、天气、通用知识）。
    企业内部问题应优先使用 search_knowledge_base。

    Args:
        query: 搜索关键词

    Returns:
        Web 搜索结果摘要
    """
    if not settings.TAVILY_API_KEY:
        return "Web 搜索工具未配置（缺少 TAVILY_API_KEY），无法执行互联网搜索。"

    try:
        from langchain_tavily import TavilySearch

        tavily = TavilySearch(max_results=5, topic="general")
        results = await tavily.ainvoke(query)

        if not results:
            return "未在互联网上找到相关信息。"

        output_parts = ["互联网搜索结果：\n"]
        for i, r in enumerate(results, 1):
            if isinstance(r, str):
                output_parts.append(f"[{i}] {r[:300]}\n")
            elif isinstance(r, dict):
                title = r.get("title", "无标题")
                content = r.get("content", "")[:300]
                url = r.get("url", "")
                output_parts.append(f"[{i}] {title}\n{content}\n来源: {url}\n")
            else:
                output_parts.append(f"[{i}] {str(r)[:300]}\n")
        return "\n".join(output_parts)

    except ImportError:
        return "Web 搜索工具未安装，请执行: pip install langchain-tavily"
    except Exception as e:
        logger.error(f"[Tool:search_web] 搜索失败: {e}", exc_info=True)
        return f"Web 搜索失败: {str(e)[:200]}"


@tool
async def send_enterprise_email(to_email: str, subject: str, body: str) -> str:
    """
    发送企业邮件。
    仅在用户明确要求发送邮件时使用，不要自动发送。
    发送前应向用户确认收件人、主题和正文内容。

    Args:
        to_email: 收件人邮箱地址
        subject: 邮件主题
        body: 邮件正文（支持 HTML 格式）

    Returns:
        发送结果
    """
    try:
        from backend.modules.mail_handler import mail_handler

        success = await mail_handler.send(
            to_addrs=[to_email],
            subject=subject,
            body_html=body,
        )
        if success:
            return f"邮件已成功发送至 {to_email}"
        return f"邮件发送失败，请检查邮件服务配置"

    except Exception as e:
        logger.error(f"[Tool:send_enterprise_email] 发送失败: {e}", exc_info=True)
        return f"邮件发送失败: {str(e)[:200]}"


@tool
def get_current_time() -> str:
    """
    获取当前日期和时间（上海时区 UTC+8）。
    当用户询问"现在几点"、"今天日期"、"星期几"等时间相关问题时使用。

    Returns:
        格式化的当前时间字符串
    """
    shanghai_tz = timezone(timedelta(hours=8))
    now = datetime.now(shanghai_tz)
    weekday_map = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    return (
        f"当前时间: {now.strftime('%Y年%m月%d日 %H:%M:%S')} "
        f"{weekday_map[now.weekday()]} (上海时区)"
    )


def get_all_tools() -> list:
    """获取所有注册的企业工具"""
    tools = [search_knowledge_base, get_current_time]

    if settings.TAVILY_API_KEY:
        tools.append(search_web)

    tools.append(send_enterprise_email)

    return tools
