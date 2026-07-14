# backend/main.py
"""
FastAPI 主应用入口。

职责：
1. 创建应用实例并配置安全策略（禁用 docs, CORS）
2. 注册 Lifespan 管理资源生命周期（向量库连接池）
3. 注册全局中间件（CORS, Request ID, 安全网关）
4. 注册全局异常处理器（隐藏堆栈，返回 request_id）
5. 挂载所有业务路由

⚠️ 铁律：
- 所有配置必须来自 core.config.settings
- 生产环境禁止暴露 Swagger/ReDoc
- 异常处理必须记录完整上下文到日志
- Lifespan 必须确保资源释放（即使底层模块未提供 close()）
"""

import sys
import os

# 修复 Windows 控制台中文乱码问题
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.core.config import settings
from backend.core.database import init_db, close_db, get_db_type
from backend.core.security_gateway import security_gateway
from backend.api.knowledge_routes import router as knowledge_router
from backend.api.qa_routes import router as qa_router
from backend.api.mail_routes import router as mail_router
from backend.api.auth_routes import router as auth_router
from backend.core.seed import seed_users
from backend.modules.vector_store import vector_store

# 配置日志（必须在任何 logger.getLogger 之前）
logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s:%(lineno)d | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ============================================================================
# 1. Lifespan: 管理应用生命周期（启动/关闭）
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理器。

    启动时：
        - 初始化 VectorStore 连接池
    关闭时：
        - 释放 VectorStore 连接池
    """
    logger.info("🚀 应用启动中...")

    # 启动时：初始化数据库连接池并建表
    await init_db()

    # 启动时：初始化 VectorStore 连接（PostgreSQL 原生，无锁冲突）
    await vector_store.connect()

    # 启动时：创建种子用户
    from backend.core.database import async_session_factory
    async with async_session_factory() as session:
        await seed_users(session)

    app.state.vector_store = vector_store

    try:
        yield
    finally:
        # 关闭时：确保连接池释放
        logger.info("🛑 应用关闭中，正在清理资源...")
        await close_db()
        await vector_store.close()
        logger.info("✅ 向量存储已优雅关闭")


# ============================================================================
# 2. 全局中间件
# ============================================================================

class RequestIdMiddleware(BaseHTTPMiddleware):
    """为每个请求注入唯一 request_id，用于日志追踪和问题定位"""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityGatewayMiddleware(BaseHTTPMiddleware):
    """安全网关中间件：执行输入校验与脱敏"""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            try:
                body = await request.body()
                if body:
                    text = body.decode("utf-8", errors="ignore")
                    is_safe, reason = security_gateway.check_prompt_injection(text)
                    if not is_safe:
                        logger.warning(
                            f"[Security] Prompt注入拦截 | Reason: {reason} | "
                            f"Request-ID: {getattr(request.state, 'request_id', 'N/A')}"
                        )
                        return JSONResponse(
                            status_code=400,
                            content={"error": "Invalid input detected", "detail": reason}
                        )

                    async def receive():
                        return {"type": "http.request", "body": body}
                    request = Request(request.scope, receive)
            except ValueError as e:
                logger.warning(
                    f"[Security] 输入校验异常: {e} | Request-ID: {getattr(request.state, 'request_id', 'N/A')}")

        response = await call_next(request)
        return response


# ============================================================================
# 3. 异常处理器
# ============================================================================

async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    全局未捕获异常处理器。

    行为：
    - 记录完整异常堆栈（含 request_id, method, url）
    - 返回最小化错误信息（生产环境不暴露堆栈）
    - 保留 request_id 供运维追踪
    """
    request_id = getattr(request.state, "request_id", "unknown")
    method = request.method
    url = str(request.url)

    # 记录完整堆栈到日志（仅限 DEBUG 或 ERROR 级别）
    logger.error(
        "💥 未捕获异常 | Request-ID: %s | Method: %s | URL: %s",
        request_id, method, url,
        exc_info=True  # 关键：记录完整堆栈
    )

    # 返回用户友好但安全的响应
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "request_id": request_id,
            "detail": "An unexpected error occurred. Please contact support with the request_id."
        }
    )


# ============================================================================
# 4. 创建 FastAPI App
# ============================================================================

app = FastAPI(
    title="Enterprise RAG Agent API",
    version=settings.APP_VERSION,
    description="企业级知识库智能体后端服务",
    docs_url="/docs" if settings.APP_ENV == "development" else None,
    redoc_url="/redoc" if settings.APP_ENV == "development" else None,
    lifespan=lifespan,
    openapi_tags=[
        {"name": "Knowledge", "description": "知识库管理"},
        {"name": "QA", "description": "问答与检索"},
        {"name": "Mail", "description": "邮件AI助理"},
        {"name": "Auth", "description": "用户认证与授权"},
    ],
)

# 添加中间件（顺序很重要！）
app.add_middleware(RequestIdMiddleware)
app.add_middleware(SecurityGatewayMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# 注册全局异常处理器
app.add_exception_handler(Exception, unhandled_exception_handler)

# 挂载路由
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["Knowledge"])
app.include_router(qa_router, prefix="/api/qa", tags=["QA"])
app.include_router(mail_router, prefix="/api/mail", tags=["Mail"])
app.include_router(auth_router, tags=["Auth"])


# ============================================================================
# 5. 监测记录
# ============================================================================
import time as _time
_start_time = _time.time()


# ============================================================================
# 6. 健康检查端点
# ============================================================================

@app.get("/healthz", include_in_schema=False)
async def health_check():
    """健康检查端点，用于 K8s/LB 探针"""
    return {"status": "healthy", "service": "enterprise_rag_agent", "version": settings.APP_VERSION}


@app.get("/api/health", include_in_schema=False)
async def api_health_check():
    """前端联调用健康检查端点，返回各服务连接状态"""
    import redis.asyncio as aioredis

    # 向量存储：PG 原生模式，始终可用
    pg_vector_ok = vector_store.is_available

    pg_ok = get_db_type() == "postgresql"

    redis_ok = False
    try:
        r = aioredis.from_url(str(settings.REDIS_URL), socket_connect_timeout=3, protocol=2)
        await r.ping()
        await r.aclose()
        redis_ok = True
    except Exception:
        pass

    return {
        "code": 200,
        "message": "ok",
        "data": {
            "vector_store": pg_vector_ok,
            "postgres": pg_ok,
            "redis": redis_ok,
            "uptime": int(_time.time() - _start_time),
            "db_type": get_db_type(),
        },
    }


@app.get("/api/config", include_in_schema=False)
async def api_config():
    """返回前端需要的 AI 模型配置信息"""
    return {
        "code": 200,
        "message": "ok",
        "data": {
            "model_name": settings.AGENT_MODEL_NAME,
            "api_endpoint": settings.DASHSCOPE_BASE_URL,
            "temperature": str(settings.AGENT_TEMPERATURE),
            "embedding_model": settings.EMBEDDING_MODEL_NAME,
        },
    }