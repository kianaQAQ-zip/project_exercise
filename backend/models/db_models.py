# backend/models/db_models.py
import uuid
import enum
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import String, Text, Integer, DateTime, Enum, ForeignKey, JSON, Index, Boolean, Float
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    """SQLAlchemy 2.0 声明式基类"""
    pass


# ================= 枚举类型定义 =================

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    EMPLOYEE = "employee"


class User(Base):
    """系统用户模型"""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="userrole", create_constraint=True),
        default=UserRole.EMPLOYEE, nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True, index=True, comment="用户邮箱")
    department: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False
    )


class DocumentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# ================= 核心实体定义 =================

class MailMessage(Base):
    """邮件消息实体（从IMAP拉取后持久化存储）"""
    __tablename__ = "mail_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, comment="所属用户 ID")
    mail_uid: Mapped[str] = mapped_column(String(64), nullable=False, comment="IMAP 邮件 UID")
    sender: Mapped[str] = mapped_column(String(255), nullable=False, comment="发件人")
    subject: Mapped[str] = mapped_column(Text, nullable=False, comment="邮件主题")
    body: Mapped[str] = mapped_column(Text, nullable=False, comment="邮件正文")
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="AI 摘要")
    category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, index=True, comment="分类: URGENT/INQUIRY/NOTIFICATION/SPAM/UNKNOWN")
    confidence: Mapped[float] = mapped_column(Float, default=0.0, comment="AI 分类置信度")
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否有附件")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True, comment="是否已读")
    mail_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True, comment="邮件原始日期")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False, comment="收录时间")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    def __repr__(self) -> str:
        return f"<MailMessage(id={self.id}, subject={self.subject}, is_read={self.is_read})>"


class UserMailAccount(Base):
    """用户绑定的邮箱账号（支持网易163、QQ、Gmail等）"""
    __tablename__ = "user_mail_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True, comment="关联的用户ID")

    # 邮箱服务商配置
    provider: Mapped[str] = mapped_column(String(50), default="163", comment="邮箱服务商: 163, qq, gmail, outlook")
    email_address: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True, comment="完整邮箱地址")

    # IMAP 配置
    imap_host: Mapped[str] = mapped_column(String(255), default="imap.163.com", comment="IMAP 服务器")
    imap_port: Mapped[int] = mapped_column(Integer, default=993, comment="IMAP 端口")

    # SMTP 配置
    smtp_host: Mapped[str] = mapped_column(String(255), default="smtp.163.com", comment="SMTP 服务器")
    smtp_port: Mapped[int] = mapped_column(Integer, default=465, comment="SMTP 端口")

    # 认证信息（生产环境应加密存储）
    encrypted_password: Mapped[str] = mapped_column(String(500), nullable=False, comment="加密后的授权码/密码")

    # 状态管理
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否启用")
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, comment="最后同步时间")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False)

    def __repr__(self) -> str:
        return f"<UserMailAccount(user_id={self.user_id}, email={self.email_address})>"


class Document(Base):
    """知识库文档实体"""
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    filename: Mapped[str] = mapped_column(String(255), nullable=False, comment="原始文件名")
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True,
                                           comment="SHA256 文件指纹，用于防重")
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, comment="文件大小 (Bytes)")
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False, comment="真实 MIME 类型")

    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True, comment="文档分类，如'软件测试'、'项目管理'")

    status: Mapped[DocumentStatus] = mapped_column(
        Enum(DocumentStatus), default=DocumentStatus.PENDING, index=True, comment="处理状态"
    )
    error_msg: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="失败时的错误信息")

    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, comment="所属用户/租户 ID")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, onupdate=_utc_now,
                                                 nullable=False)

    chunks: Mapped[List["Chunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        lazy="selectin"
    )

    @property
    def chunk_count(self) -> int:
        """返回该文档的文本块数量（供 Pydantic schema 序列化）"""
        return len(self.chunks) if self.chunks else 0

    def __repr__(self) -> str:
        return f"<Document(id={self.id}, filename={self.filename}, status={self.status})>"


class Chunk(Base):
    """文档分块实体"""
    __tablename__ = "chunks"

    __table_args__ = (
        Index('ix_chunks_doc_index', 'document_id', 'chunk_index'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, comment="在原文档中的顺序索引")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="分块后的纯文本内容")

    chunk_metadata: Mapped[Optional[dict]] = mapped_column("metadata", JSON, nullable=True, comment="结构化元数据")

    embedding: Mapped[Optional[List[float]]] = mapped_column(
        "embedding", JSON, nullable=True,
        comment="向量嵌入（1024维 float 数组），存为 JSON 数组格式，直接用于余弦相似度计算"
    )

    vector_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True,
                                                     comment="已废弃：向量已内嵌，此字段保留兼容旧逻辑")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="chunks")


class Conversation(Base):
    """对话记录实体"""
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True, comment="LangGraph 会话 ID")
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True, comment="所属用户 ID")
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="新对话", comment="对话标题")
    starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否星标（重点记录）")
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, comment="消息数量")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, onupdate=_utc_now, nullable=False)

    def __repr__(self) -> str:
        return f"<Conversation(id={self.id}, title={self.title}, starred={self.starred})>"
