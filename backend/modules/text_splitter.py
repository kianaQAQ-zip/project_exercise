# backend/modules/text_splitter.py
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from langchain_text_splitters import (
    RecursiveCharacterTextSplitter,
    MarkdownHeaderTextSplitter,
)

from backend.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class TextChunk:
    """标准化的文本块数据结构"""
    content: str
    metadata: Dict[str, Any]  # 包含 doc_id, page_number, chunk_index, headers 等


class SemanticTextSplitter:
    """
    企业级语义文本分块器。
    核心策略：优先按 Markdown 标题层级切分 -> 递归按段落/句子切分 -> 强制兜底按字符切分。
    全程保持 metadata 继承与 chunk_index 连续。
    """

    def __init__(self):
        self.chunk_size = settings.CHUNK_SIZE
        self.chunk_overlap = settings.CHUNK_OVERLAP

        # Markdown 标题层级分割器（保留标题语义到 metadata）
        self._md_header_splitter = MarkdownHeaderTextSplitter(
            headers_to_split_on=[
                ("#", "header_1"),
                ("##", "header_2"),
                ("###", "header_3"),
                ("####", "header_4"),
            ],
            strip_headers=False,  # 保留标题原文，增强检索语义
        )

        # 递归字符分割器（按语义优先级逐级尝试）
        self._recursive_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", "。", ".", "！", "!", "？", "?", "；", ";", " ", ""],
            length_function=len,
            is_separator_regex=False,
        )

        logger.info(
            f"✂️ TextSplitter 初始化完成 | "
            f"chunk_size={self.chunk_size} | overlap={self.chunk_overlap}"
        )

    def split_document(
        self,
        text: str,
        base_metadata: Optional[Dict[str, Any]] = None,
    ) -> List[TextChunk]:
        """
        对单篇文档执行语义分块。

        Args:
            text: 原始文本内容（推荐传入 Docling 转换后的 Markdown）
            base_metadata: 文档级基础元数据（doc_id, filename, department_id 等）

        Returns:
            标准化 TextChunk 列表，chunk_index 从 0 连续递增
        """
        if not text or not text.strip():
            logger.warning("[TextSplitter] 收到空文本，跳过处理")
            return []

        base_meta = base_metadata or {}
        chunks: List[TextChunk] = []
        global_index = 0

        try:
            # Step 1: 尝试按 Markdown 标题切分
            md_sections = self._md_header_splitter.split_text(text)

            if len(md_sections) <= 1 and len(text) > self.chunk_size * 2:
                # Markdown 切分未生效（纯文本或无标题），直接走递归切分
                logger.debug("[TextSplitter] 未检测到有效 Markdown 结构，降级为递归字符切分")
                raw_chunks = self._recursive_splitter.split_text(text)
                for chunk_text in raw_chunks:
                    chunks.append(TextChunk(
                        content=chunk_text,
                        metadata={**base_meta, "chunk_index": global_index},
                    ))
                    global_index += 1
            else:
                # Step 2: 对每个 Markdown 章节再做递归切分（防止单个章节超长）
                for section in md_sections:
                    section_meta = {
                        **base_meta,
                        **section.metadata,  # header_1, header_2 等自动注入
                    }

                    if len(section.page_content) <= self.chunk_size:
                        chunks.append(TextChunk(
                            content=section.page_content,
                            metadata={**section_meta, "chunk_index": global_index},
                        ))
                        global_index += 1
                    else:
                        sub_chunks = self._recursive_splitter.split_text(section.page_content)
                        for sub_text in sub_chunks:
                            chunks.append(TextChunk(
                                content=sub_text,
                                metadata={**section_meta, "chunk_index": global_index},
                            ))
                            global_index += 1

            logger.info(
                f"[TextSplitter] 分块完成 | "
                f"原文长度={len(text)} | 产出块数={len(chunks)} | "
                f"平均块长={sum(len(c.content) for c in chunks) // max(len(chunks), 1)}"
            )
            return chunks

        except Exception as e:
            logger.error(f"[TextSplitter] 分块异常，降级为纯字符切分: {e}", exc_info=True)
            # 终极兜底：确保任何情况下都能返回结果，不阻断入库流程
            fallback_chunks = self._recursive_splitter.split_text(text)
            return [
                TextChunk(
                    content=c,
                    metadata={**base_meta, "chunk_index": i, "_fallback": True},
                )
                for i, c in enumerate(fallback_chunks)
            ]


# 导出全局单例
text_splitter = SemanticTextSplitter()