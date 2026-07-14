# backend/tasks/celery_app.py
"""
Celery Application 独立定义模块。

职责：
1. 创建并配置 Celery App 实例
2. 注册 Worker 生命周期信号钩子
3. 自动发现所有 task 模块

⚠️ 注意：
- 本模块不应包含任何具体 Task 定义
- 所有配置必须来自 core.config.settings，禁止硬编码
- 外部统一通过 backend.tasks.__init__ 导入 celery_app，勿直接引用本模块
"""

import os
import logging

# === Redis 5.x 兼容：强制使用 RESP2 协议 ===
os.environ.setdefault("REDIS_HELLO_FORCE_RESP2", "1")

from celery import Celery
from celery.signals import worker_init, worker_shutdown, setup_logging

from backend.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 1. 创建 Celery App 实例
# ---------------------------------------------------------------------------
celery_app = Celery(
    "enterprise_rag_tasks",
    broker=str(settings.REDIS_URL),
    backend=str(settings.REDIS_URL),
)

# ---------------------------------------------------------------------------
# 2. 全局配置
# ---------------------------------------------------------------------------
celery_app.conf.update(
    # === 序列化与安全 ===
    task_serializer="json",
    accept_content=["json"],          # 仅接受 JSON，禁用 pickle 防反序列化攻击
    result_serializer="json",

    # === Redis 兼容（RESP2，兼容 Redis 5.x） ===
    broker_transport_options={"global_keyprefix": "celery_"},
    broker_connection_retry_on_startup=True,

    # === 时区 ===
    timezone="Asia/Shanghai",
    enable_utc=True,

    # === 可靠性 ===
    task_acks_late=True,              # 任务执行完毕后才 ACK，防止 Worker 崩溃丢任务
    task_reject_on_worker_lost=True,  # Worker 异常退出时 NACK 并重新入队
    result_expires=86400,             # 结果保留 24h，避免 Redis 内存膨胀

    # === 并发与限流 ===
    worker_concurrency=4,             # 单 Worker 并发数，防止 OOM
    task_queue_max_priority=10,       # 启用优先级队列支持
    task_default_priority=5,          # 默认中等优先级

    # === 自动发现 ===
    include=["backend.tasks.document_tasks"],
)


# ---------------------------------------------------------------------------
# 3. Worker 生命周期信号钩子
# ---------------------------------------------------------------------------

@setup_logging.connect
def on_setup_logging(loglevel, logfile, format, colorize, **kwargs):
    """
    接管 Celery 日志配置，使其与 FastAPI 侧的 logging 格式保持一致。
    避免 Worker 输出格式与主应用不统一导致日志采集困难。
    """
    logging.basicConfig(
        level=loglevel,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


@worker_init.connect
def on_worker_init(sender=None, **kwargs):
    """
    Worker 进程启动后触发。
    初始化数据库引擎和 Session Factory（不建立连接，避免事件循环绑定问题）。
    """
    from backend.core.database import create_engine, _init_factory, get_db_type

    engine = create_engine()
    import backend.core.database as db_module
    db_module.engine = engine
    db_module._db_type = get_db_type()
    _init_factory()

    logger.info("🟢 Celery Worker 初始化完成 | concurrency=%s | db_type=%s", sender.concurrency, get_db_type())


@worker_shutdown.connect
def on_worker_shutdown(sender=None, **kwargs):
    """
    Worker 进程关闭前触发。
    TODO: [待对接] 在此处关闭数据库连接池
          防止连接泄露。对应 main.py lifespan 中的资源清理逻辑。
    """
    logger.info("🔴 Celery Worker 正在关闭，释放资源...")