# backend/services/chat_service.py
"""
RAG 回答后处理服务。

核心职责：
1. 引用标记 [n] 的提取与合法性校验（防 LLM 幻觉伪造引用）
2. 回答文本的安全合规清洗

⚠️ 设计哲学：确定性约束 AI — 绝不信任 LLM 输出的引用标记，必须与 RAG 实际召回做交集校验。
"""

import re
import logging
from typing import List, Dict, Any, Set, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class CitationValidationResult:
    """引用校验结果"""
    valid_citations: List[int]
    invalid_citations: List[int]
    cleaned_text: str


class CitationProcessor:
    """
    LLM 输出引用标记的校验与清洗器。

    核心逻辑：
    1. 正则提取 LLM 回答中所有的 [n] 引用标记
    2. 与 RAG 实际召回的 sources 索引做交集
    3. 剔除虚假引用（LLM 幻觉捏造的不存在的引用编号）
    4. 返回清洗后的文本和合法的引用列表
    """

    CITATION_PATTERN = re.compile(r'\[(\d+)\]')

    def extract_citations(self, text: str) -> List[int]:
        """从文本中提取所有 [n] 引用标记，返回去重后的索引列表"""
        matches = self.CITATION_PATTERN.findall(text)
        seen: Set[int] = set()
        result = []
        for m in matches:
            idx = int(m)
            if idx not in seen:
                seen.add(idx)
                result.append(idx)
        return result

    def validate_and_clean(
            self,
            answer_text: str,
            valid_source_count: int,
    ) -> CitationValidationResult:
        """
        校验引用标记的合法性并清洗文本。

        规则：
        - 引用编号必须在 [1, valid_source_count] 范围内
        - 超出范围的引用标记从文本中移除（替换为空字符串）
        - 返回合法引用列表和被剔除的非法引用列表

        Args:
            answer_text: LLM 生成的原始回答文本
            valid_source_count: RAG 实际召回的有效来源数量

        Returns:
            CitationValidationResult
        """
        all_citations = self.extract_citations(answer_text)

        valid_range = set(range(1, valid_source_count + 1))
        valid_citations = [c for c in all_citations if c in valid_range]
        invalid_citations = [c for c in all_citations if c not in valid_range]

        if invalid_citations:
            logger.warning(
                f"[CitationProcessor] 检测到虚假引用: {invalid_citations} | "
                f"合法来源数: {valid_source_count}"
            )

        cleaned_text = answer_text
        for bad_idx in invalid_citations:
            cleaned_text = cleaned_text.replace(f"[{bad_idx}]", "")

        # 清理可能产生的多余空格
        cleaned_text = re.sub(r'  +', ' ', cleaned_text).strip()

        return CitationValidationResult(
            valid_citations=valid_citations,
            invalid_citations=invalid_citations,
            cleaned_text=cleaned_text,
        )

    def format_sources(
            self,
            sources: List[Dict[str, Any]],
            valid_citations: List[int],
    ) -> List[Dict[str, Any]]:
        """
        仅保留被合法引用的来源，过滤掉未被引用的来源。
        确保前端展示的引用卡片与回答中的 [n] 标记一一对应。
        """
        valid_set = set(valid_citations)
        return [
            src for src in sources
            if src.get("ref_index") in valid_set
        ]


# 导出全局单例
citation_processor = CitationProcessor()
