# backend/models/schemas.py
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal, Generic, TypeVar
from pydantic import BaseModel, Field, ConfigDict, EmailStr, field_validator

# ================= 全局基础契约 =================

# 定义泛型，用于统一 API 响应信封结构
T = TypeVar('T')


class APIResponse(BaseModel, Generic[T]):
    """统一的标准 API 响应信封 (所有非流式接口必须返回此格式)"""
    code: int = Field(default=200, description="业务状态码 (200为成功，非200为异常)")
    message: str = Field(default="success", description="提示信息")
    data: Optional[T] = Field(default=None, description="响应数据载荷")


class PaginatedResult(BaseModel, Generic[T]):
    """分页数据载荷"""
    items: list[T] = Field(default_factory=list, description="当前页数据列表")
    total: int = Field(default=0, description="总记录数")


class PaginatedResponse(BaseModel, Generic[T]):
    """分页 API 响应信封"""
    code: int = Field(default=200, description="业务状态码")
    message: str = Field(default="success", description="提示信息")
    data: list[T] = Field(default_factory=list, description="当前页数据列表")
    total: int = Field(default=0, description="总记录数")


class HealthCheckResponse(BaseModel):
    """系统健康探针响应 (供 K8s/Docker 探活使用)"""
    status: Literal["healthy", "degraded", "unhealthy"]
    version: str
    db_connected: bool
    vector_db_connected: bool
    llm_reachable: bool


# ================= 知识库相关 Schema =================

class DocumentUploadResponse(BaseModel):
    """文档上传成功响应"""
    document_id: str = Field(..., description="文档唯一标识")
    filename: str
    status: str = Field(default="PENDING", description="当前处理状态")
    message: str = Field(default="文件已接收，正在后台异步解析中...")
    category: Optional[str] = Field(default=None, description="文档分类")


class DocumentDetailResponse(BaseModel):
    """文档详情响应 (支持 ORM 直接转换)"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_size: int
    mime_type: str
    status: str
    category: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    error_msg: Optional[str] = None
    chunk_count: int = Field(default=0, description="解析出的文本块数量")


class DocumentListResponse(BaseModel):
    """文档列表分页响应"""
    total: int
    items: List[DocumentDetailResponse]


# ================= RAG 问答相关 Schema =================

class AskRequest(BaseModel):
    """RAG 提问请求载荷"""
    query: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="用户提问内容",
        examples=["公司最新的报销流程是什么？"]
    )
    session_id: str = Field(..., description="会话 ID，用于上下文追溯")
    top_k: int = Field(default=5, ge=1, le=20, description="检索返回的上下文数量")

    @field_validator('query')
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("提问内容不能为空")
        return v


class RetrievalContext(BaseModel):
    """RAG 检索到的上下文片段 (用于前端展示引用来源)"""
    chunk_id: str
    document_id: str
    document_name: str
    content: str
    score: float = Field(..., ge=0.0, le=1.0, description="相似度得分")
    metadata: Optional[Dict[str, Any]] = None


class StreamEvent(BaseModel):
    """
    SSE 流式输出事件结构 (前端解析契约)
    前端通过 EventSource 监听，并根据 event 类型渲染 UI
    """
    event: Literal["meta", "chunk", "sources", "done", "error"] = Field(
        ..., description="事件类型"
    )
    data: Any = Field(..., description="事件数据载荷")


# ================= 对话记录相关 Schema =================

class ConversationItem(BaseModel):
    """对话记录列表项"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    title: str
    starred: bool = False
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


class ConversationCreateRequest(BaseModel):
    """创建对话请求"""
    session_id: str = Field(..., description="LangGraph 会话 ID")
    title: str = Field(default="新对话", max_length=255, description="对话标题")


class ConversationTitleRequest(BaseModel):
    """更新对话标题请求"""
    title: str = Field(..., max_length=255, description="新标题")


class ConversationTitleGenerateRequest(BaseModel):
    """生成对话标题请求"""
    session_id: str = Field(..., description="会话 ID")
    user_message: str = Field(..., max_length=500, description="用户的第一条消息，用于生成标题")
