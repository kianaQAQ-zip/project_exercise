# backend/core/config.py
import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional, Literal, List
from pydantic import BaseModel, Field, field_validator, model_validator, PostgresDsn, RedisDsn, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class LLMConfig(BaseModel):
    """大语言模型配置（单条链路）"""
    api_key: str = Field("", description="API 密钥")
    base_url: HttpUrl = Field("https://api.openai.com/v1", description="API Base URL")
    model_name: str = Field("gpt-4o", description="模型标识符")
    timeout: float = Field(30.0, ge=5.0, le=120.0, description="单次请求超时时间(秒)")
    max_retries: int = Field(3, ge=0, le=5, description="网络异常最大重试次数")


class MailConfig(BaseModel):
    """企业邮件服务配置（单账号共享模式下的默认配置）"""
    imap_host: str = Field("imap.163.com", description="IMAP 服务器地址")
    imap_port: int = Field(993, gt=0, le=65535)
    smtp_host: str = Field("smtp.163.com", description="SMTP 服务器地址")
    smtp_port: int = Field(465, gt=0, le=65535)
    username: str = Field("", description="邮箱账号（多用户模式下可为空）")
    password: str = Field("", description="邮箱授权码（多用户模式下可为空）")
    use_ssl: bool = Field(True, description="是否强制使用 SSL/TLS")


class Settings(BaseSettings):
    """全局应用配置中心"""

    # === 基础运行环境 ===
    APP_ENV: Literal["development", "staging", "production"] = Field("development")
    DEBUG: bool = Field(False)
    SECRET_KEY: str = Field(..., min_length=32, description="JWT/Session 签名密钥，生产环境必须>=32位")

    # === 基础设施连接串 ===
    POSTGRES_URL: PostgresDsn = Field(..., description="PostgreSQL 异步连接串 (postgresql+asyncpg://...)")
    REDIS_URL: RedisDsn = Field(..., description="Redis 连接串 (redis://...)")
    MILVUS_HOST: str = Field("", description="已废弃：向量存储已迁移至 PostgreSQL")
    EMBEDDING_DIM: int = Field(1024, ge=128, le=4096, description="Embedding 向量维度（text-embedding-v3 默认 1024）")

    # === Agent / LLM 配置 (DashScope 兼容 OpenAI 协议) ===
    DASHSCOPE_BASE_URL: str = Field("https://dashscope.aliyuncs.com/compatible-mode/v1", description="模型 API Base URL")
    DASHSCOPE_API_KEY: str = Field(..., description="模型 API Key")
    AGENT_MODEL_NAME: str = Field("qwen-plus", description="Agent 使用的模型名称")
    AGENT_TEMPERATURE: float = Field(0.7, ge=0.0, le=2.0, description="Agent 对话温度")
    EMBEDDING_MODEL_NAME: str = Field("text-embedding-v3", description="Embedding 模型名称（DashScope/text-embedding-v3 或 OpenAI text-embedding-3-small）")

    # === 嵌套业务配置 ===
    PRIMARY_LLM: LLMConfig = Field(default_factory=LLMConfig)
    FALLBACK_LLM: Optional[LLMConfig] = None

    # ===================== 安全 =====================
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=480, description="JWT 访问令牌过期时间 (分钟)")
    JWT_ALGORITHM: str = Field(default="HS256", description="JWT 签名算法")

    MAIL: MailConfig = Field(default_factory=MailConfig)

    # === Web 搜索 ===
    TAVILY_API_KEY: Optional[str] = Field(None, description="Tavily Web 搜索 API Key")

    # === RAG 与解析参数 ===
    CHUNK_SIZE: int = Field(500, ge=100, le=2000, description="文本分块大小")
    CHUNK_OVERLAP: int = Field(50, ge=0, le=500, description="分块重叠字符数")
    MAX_UPLOAD_SIZE_MB: int = Field(50, ge=1, le=500, description="单文件上传上限(MB)")

    # === RAG 检索参数 ===
    RAG_TOP_K: int = Field(5, ge=1, le=20, description="RAG 向量检索 Top-K 数量")
    RAG_RERANK_TOP_N: int = Field(3, ge=1, le=10, description="Rerank 后保留的最终条数")
    RAG_SCORE_THRESHOLD: float = Field(0.3, ge=0.0, le=1.0, description="向量相似度阈值，低于此值的命中被过滤")
    RAG_MAX_CONTEXT_TOKENS: int = Field(4000, ge=500, le=16000, description="RAG 上下文最大 Token 数")
    RAG_FALLBACK_ENABLED: bool = Field(True, description="检索失败时是否启用降级（用 LLM 自身知识回答）")

    # === 临时文件目录 ===
    TEMP_UPLOAD_DIR: str = Field(default="/tmp/enterprise_ai_uploads", description="临时文件上传目录")

    # === 应用版本 ===
    APP_VERSION: str = Field(default="0.1.0", description="应用版本号")

    # === 数据库连接池 ===
    DB_POOL_SIZE: int = Field(default=10, ge=1, le=100, description="数据库连接池大小")
    DB_MAX_OVERFLOW: int = Field(default=20, ge=0, le=200, description="最大溢出连接数")
    DB_POOL_TIMEOUT: int = Field(default=30, ge=1, le=120, description="获取连接超时(秒)")
    DB_POOL_RECYCLE: int = Field(default=1800, ge=60, le=7200, description="连接回收时间(秒)")

    # === 日志 ===
    LOG_LEVEL: str = Field(default="INFO", description="日志级别")

    # === CORS ===
    CORS_ORIGINS: List[str] = Field(default=["http://localhost:3000"], description="CORS 允许的源")

    # Pydantic V2 配置：从 .env 读取，支持嵌套环境变量前缀
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent.parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="forbid",  # 禁止未定义的环境变量，防止拼写错误被静默忽略
        env_nested_delimiter="__",
    )

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str, info) -> str:
        """生产环境安全兜底校验"""
        if info.data.get("APP_ENV") == "production" and (len(v) < 32 or v == "change-me-in-production"):
            raise ValueError("🚨 生产环境 SECRET_KEY 强度不足！请设置至少32位的随机强密钥。")
        return v

    @field_validator("CHUNK_OVERLAP")
    @classmethod
    def validate_chunk_overlap(cls, v: int, info) -> int:
        """防止重叠大于分块导致死循环或语义崩坏"""
        chunk_size = info.data.get("CHUNK_SIZE", 500)
        if v >= chunk_size:
            raise ValueError(f"CHUNK_OVERLAP({v}) 必须严格小于 CHUNK_SIZE({chunk_size})")
        return v

    @model_validator(mode="after")
    def _wire_primary_llm_from_dashscope(self) -> "Settings":
        """当 PRIMARY_LLM 未显式配置时，从 DASHSCOPE_* 顶级字段自动填充"""
        if self.PRIMARY_LLM is None or not self.PRIMARY_LLM.api_key:
            self.PRIMARY_LLM = LLMConfig(
                api_key=self.DASHSCOPE_API_KEY,
                base_url=self.DASHSCOPE_BASE_URL,
                model_name=self.AGENT_MODEL_NAME,
                timeout=30.0,  # DashScope 默认超时 30s
                max_retries=3,
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    获取全局配置单例。
    使用 lru_cache 确保整个应用生命周期内只解析一次 .env，
    避免重复 IO 和校验开销。
    """
    try:
        settings = Settings()
        logger.info(f"✅ 配置加载成功 | ENV={settings.APP_ENV} | DEBUG={settings.DEBUG}")
        return settings
    except Exception as e:
        logger.critical(f"❌ 配置加载失败，应用拒绝启动: {e}")
        raise SystemExit(1) from e


# 导出便捷访问对象（仅在模块首次导入时触发校验）
settings = get_settings()