import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.security import hash_password
from backend.models.db_models import User, UserRole

logger = logging.getLogger(__name__)

SEED_USERS = [
    {
        "username": "admin",
        "password": "admin123",
        "display_name": "系统管理员",
        "email": "admin@enterprise.local",
        "role": UserRole.ADMIN,
        "department": "技术部",
    },
    {
        "username": "employee",
        "password": "emp123456",
        "display_name": "张小明",
        "email": "zhangxiaoming@enterprise.local",
        "role": UserRole.EMPLOYEE,
        "department": "市场部",
    },
]


async def seed_users(db: AsyncSession) -> None:
    for seed in SEED_USERS:
        result = await db.execute(select(User).where(User.username == seed["username"]))
        existing = result.scalar_one_or_none()
        if existing is None:
            user = User(
                username=seed["username"],
                password_hash=hash_password(seed["password"]),
                display_name=seed["display_name"],
                email=seed["email"],
                role=seed["role"],
                department=seed["department"],
            )
            db.add(user)
            logger.info(f"👤 种子用户已创建: {seed['username']} ({seed['role'].value})")
        else:
            logger.debug(f"👤 种子用户已存在: {seed['username']}")

    await db.commit()
    logger.info("✅ 种子用户初始化完成")