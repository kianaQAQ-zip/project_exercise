# tests/unit/test_text_splitter.py
"""
SemanticTextSplitter 单元测试。

覆盖场景：
1. Markdown 标题层级切分
2. 纯文本递归切分（无 Markdown 结构时降级）
3. 超长章节二次递归切分
4. 空文本/极短文本边界
5. metadata 继承与 chunk_index 连续性
6. 异常兜底（确保任何情况都不阻断入库流程）
"""

import pytest
from backend.modules.text_splitter import SemanticTextSplitter, TextChunk


@pytest.fixture
def splitter():
    return SemanticTextSplitter()


class TestEmptyAndEdgeCases:
    """空文本与边界情况"""

    def test_empty_string_returns_empty(self, splitter):
        result = splitter.split_document("")
        assert result == []

    def test_whitespace_only_returns_empty(self, splitter):
        result = splitter.split_document("   \n\n   \n  ")
        assert result == []

    def test_very_short_text(self, splitter):
        result = splitter.split_document("你好")
        assert len(result) == 1
        assert result[0].content == "你好"
        assert result[0].metadata["chunk_index"] == 0

    def test_none_metadata_defaults_to_empty_dict(self, splitter):
        result = splitter.split_document("一段测试文本，足够长以触发分块逻辑。" * 50)
        for chunk in result:
            assert isinstance(chunk.metadata, dict)
            assert "chunk_index" in chunk.metadata


class TestMarkdownSplitting:
    """Markdown 标题层级切分"""

    def test_split_by_headers(self, splitter):
        text = """# 第一章 概述
这是概述的内容，介绍了一些背景信息。

## 1.1 项目背景
项目背景的详细说明，包含了更多的文字描述。

## 1.2 项目目标
项目目标的具体阐述和关键指标。
"""
        result = splitter.split_document(text, base_metadata={"doc_id": "test-001"})
        assert len(result) >= 3

        header_values = [
            c.metadata.get("header_1") or c.metadata.get("header_2", "")
            for c in result
        ]
        assert any("第一章" in v or "概述" in v for v in header_values if v)

    def test_header_metadata_preserved(self, splitter):
        text = """# 总则
总则的内容描述。

## 第一节
第一节的具体内容，需要足够长才能成为一个完整的块。
"""
        result = splitter.split_document(text, base_metadata={"doc_id": "doc-002"})
        assert len(result) >= 2
        for chunk in result:
            assert "chunk_index" in chunk.metadata
            assert chunk.metadata["doc_id"] == "doc-002"

    def test_deep_header_hierarchy(self, splitter):
        text = """# Level 1
## Level 2
### Level 3
#### Level 4
这是一段位于四级标题下的内容，需要足够长。
"""
        result = splitter.split_document(text)
        assert len(result) >= 1
        last_chunk = result[-1]
        assert "header_4" in last_chunk.metadata or "header_3" in last_chunk.metadata


class TestPlainTextFallback:
    """纯文本无 Markdown 结构时的降级递归切分"""

    def test_plain_text_splits_by_paragraph(self, splitter):
        paragraph = "这是一段普通的纯文本内容，没有任何 Markdown 格式。" * 20
        text = f"{paragraph}\n\n{paragraph}\n\n{paragraph}"
        result = splitter.split_document(text, base_metadata={"doc_id": "plain-001"})
        assert len(result) >= 1
        for chunk in result:
            assert chunk.metadata["doc_id"] == "plain-001"

    def test_long_plain_text_gets_split(self, splitter):
        text = "这是一句很长的话。" * 500
        result = splitter.split_document(text)
        assert len(result) > 1
        for i, chunk in enumerate(result):
            assert chunk.metadata["chunk_index"] == i

    def test_no_chunk_exceeds_chunk_size_significantly(self, splitter):
        text = "短句子。" * 1000
        result = splitter.split_document(text)
        for chunk in result:
            assert len(chunk.content) <= splitter.chunk_size + 100


class TestChunkIndexContinuity:
    """chunk_index 连续性校验"""

    def test_index_starts_from_zero(self, splitter):
        text = "## 标题A\n内容A\n\n## 标题B\n内容B\n\n## 标题C\n内容C"
        result = splitter.split_document(text)
        assert result[0].metadata["chunk_index"] == 0

    def test_index_is_sequential(self, splitter):
        text = ("# 章节\n" + "段落内容。" * 30 + "\n\n") * 5
        result = splitter.split_document(text)
        indices = [c.metadata["chunk_index"] for c in result]
        assert indices == list(range(len(result)))

    def test_index_no_gaps_after_long_section_split(self, splitter):
        long_section = "# 超长章节\n" + "这是段落内容。" * 300
        text = f"{long_section}\n\n# 短章节\n短内容。"
        result = splitter.split_document(text)
        indices = [c.metadata["chunk_index"] for c in result]
        assert indices == list(range(len(result)))


class TestMetadataInheritance:
    """base_metadata 透传与合并"""

    def test_base_metadata_in_all_chunks(self, splitter):
        base = {"doc_id": "meta-001", "department_id": "dept-A", "filename": "test.md"}
        text = "# A\n内容A\n\n# B\n内容B\n\n# C\n内容C"
        result = splitter.split_document(text, base_metadata=base)
        for chunk in result:
            assert chunk.metadata["doc_id"] == "meta-001"
            assert chunk.metadata["department_id"] == "dept-A"
            assert chunk.metadata["filename"] == "test.md"

    def test_base_metadata_not_mutated(self, splitter):
        base = {"doc_id": "immutable"}
        original_keys = set(base.keys())
        text = "# 标题\n" + "内容。" * 100
        splitter.split_document(text, base_metadata=base)
        assert set(base.keys()) == original_keys


class TestExceptionFallback:
    """异常兜底：确保任何情况下都不阻断入库流程"""

    def test_fallback_returns_non_empty_for_any_text(self, splitter):
        weird_text = "Section A\n\nContent here that forms a paragraph with enough length to ensure splitting works correctly."
        result = splitter.split_document(weird_text)
        assert len(result) >= 1

    def test_fallback_chunks_have_metadata(self, splitter):
        text = "正常文本" * 50
        result = splitter.split_document(text, base_metadata={"doc_id": "fb-001"})
        for chunk in result:
            assert "chunk_index" in chunk.metadata
