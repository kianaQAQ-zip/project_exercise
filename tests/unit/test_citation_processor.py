# tests/unit/test_citation_processor.py
"""
CitationProcessor 单元测试。
确保防幻觉机制 100% 覆盖：LLM 捏造的虚假引用必须被完全剔除。
"""

import pytest
from backend.services.chat_service import CitationProcessor, CitationValidationResult


@pytest.fixture
def processor():
    return CitationProcessor()


class TestExtractCitations:
    """测试引用标记提取"""

    def test_extract_single_citation(self, processor):
        text = "根据文档 [1]，公司报销流程如下..."
        assert processor.extract_citations(text) == [1]

    def test_extract_multiple_citations(self, processor):
        text = "参考 [1] 和 [3] 的规定，结合 [2] 的说明..."
        assert processor.extract_citations(text) == [1, 3, 2]

    def test_extract_deduplicated(self, processor):
        text = "如 [1] 所述，[1] 还提到了..."
        assert processor.extract_citations(text) == [1]

    def test_extract_no_citations(self, processor):
        text = "这是一段没有引用的普通文本。"
        assert processor.extract_citations(text) == []

    def test_extract_empty_text(self, processor):
        assert processor.extract_citations("") == []

    def test_extract_mixed_content(self, processor):
        text = "步骤一 [1]：提交申请。步骤二 [2]：等待审批。详情请参考 [3]。"
        result = processor.extract_citations(text)
        assert result == [1, 2, 3]

    def test_extract_large_index(self, processor):
        text = "参见 [999] 的内容"
        assert processor.extract_citations(text) == [999]

    def test_ignore_malformed_brackets(self, processor):
        text = "这不是引用 [abc]，这也不是 [ ]，这个是 [1]"
        assert processor.extract_citations(text) == [1]


class TestValidateAndClean:
    """测试引用校验与清洗 — 防幻觉核心逻辑"""

    def test_all_citations_valid(self, processor):
        text = "根据 [1] 和 [2]，答案为是。"
        result = processor.validate_and_clean(text, valid_source_count=3)
        assert result.valid_citations == [1, 2]
        assert result.invalid_citations == []
        assert result.cleaned_text == text

    def test_fake_citation_removed(self, processor):
        """核心测试：LLM 捏造了不存在的引用 [5]，必须被移除"""
        text = "根据 [1] 可知，同时 [5] 也提到了这一点。"
        result = processor.validate_and_clean(text, valid_source_count=2)
        assert result.valid_citations == [1]
        assert result.invalid_citations == [5]
        assert "[5]" not in result.cleaned_text
        assert "[1]" in result.cleaned_text

    def test_all_citations_fake(self, processor):
        """极端情况：LLM 所有引用都是捏造的"""
        text = "答案是 [10] 和 [20]。"
        result = processor.validate_and_clean(text, valid_source_count=0)
        assert result.valid_citations == []
        assert set(result.invalid_citations) == {10, 20}
        assert "[" not in result.cleaned_text

    def test_zero_index_is_invalid(self, processor):
        """引用 [0] 不合法，因为 sources 索引从 1 开始"""
        text = "根据 [0] 和 [1]，结果为真。"
        result = processor.validate_and_clean(text, valid_source_count=2)
        assert result.valid_citations == [1]
        assert result.invalid_citations == [0]
        assert "[0]" not in result.cleaned_text

    def test_boundary_citation(self, processor):
        """恰好等于 source_count 的引用是合法的"""
        text = "参考 [3] 的内容。"
        result = processor.validate_and_clean(text, valid_source_count=3)
        assert result.valid_citations == [3]
        assert result.invalid_citations == []

    def test_boundary_plus_one_is_invalid(self, processor):
        """source_count + 1 的引用不合法"""
        text = "参考 [4] 的内容。"
        result = processor.validate_and_clean(text, valid_source_count=3)
        assert result.valid_citations == []
        assert result.invalid_citations == [4]

    def test_cleaned_text_no_double_spaces(self, processor):
        """移除引用标记后不应留下双空格"""
        text = "根据 [5] 可知结论。"
        result = processor.validate_and_clean(text, valid_source_count=2)
        assert "  " not in result.cleaned_text

    def test_mixed_valid_and_invalid(self, processor):
        """混合场景：部分合法、部分非法"""
        text = "[1] 说明了A。[2] 说明了B。[7] 说明了C。[3] 说明了D。[99] 说明了E。"
        result = processor.validate_and_clean(text, valid_source_count=3)
        assert set(result.valid_citations) == {1, 2, 3}
        assert set(result.invalid_citations) == {7, 99}
        assert "[7]" not in result.cleaned_text
        assert "[99]" not in result.cleaned_text
        assert "[1]" in result.cleaned_text


class TestFormatSources:
    """测试来源过滤 — 仅保留被合法引用的来源"""

    def test_filter_unused_sources(self, processor):
        sources = [
            {"ref_index": 1, "doc_id": "a", "snippet": "A"},
            {"ref_index": 2, "doc_id": "b", "snippet": "B"},
            {"ref_index": 3, "doc_id": "c", "snippet": "C"},
        ]
        result = processor.format_sources(sources, valid_citations=[1, 3])
        assert len(result) == 2
        assert result[0]["ref_index"] == 1
        assert result[1]["ref_index"] == 3

    def test_empty_citations_returns_empty(self, processor):
        sources = [{"ref_index": 1, "doc_id": "a", "snippet": "A"}]
        result = processor.format_sources(sources, valid_citations=[])
        assert result == []

    def test_empty_sources(self, processor):
        result = processor.format_sources([], valid_citations=[1])
        assert result == []
