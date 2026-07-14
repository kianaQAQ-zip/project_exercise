# backend/repositories/mail_account_repo.py
"""
用户邮箱账号数据访问层。

职责：
1. 绑定/解绑邮箱账号
2. 根据 user_id 查询邮箱配置
3. 更新最后同步时间
"""

from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db_models import UserMailAccount
from backend.repositories.base import BaseRepository


class MailAccountRepository(BaseRepository[UserMailAccount]):
    """用户邮箱账号专属 Repository"""

    def __init__(self):
        super().__init__(UserMailAccount)

    async def get_by_user_id(self, db: AsyncSession, user_id: str) -> Optional[UserMailAccount]:
        """根据用户 ID 查询绑定的邮箱账号"""
        result = await db.execute(
            select(UserMailAccount).where(UserMailAccount.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, db: AsyncSession, email_address: str) -> Optional[UserMailAccount]:
        """根据邮箱地址查询（检查是否已被其他用户绑定）"""
        result = await db.execute(
            select(UserMailAccount).where(UserMailAccount.email_address == email_address)
        )
        return result.scalar_one_or_none()

    async def update_last_sync(self, db: AsyncSession, user_id: str) -> Optional[UserMailAccount]:
        """更新最后同步时间"""
        from datetime import datetime, timezone
        # 先按 user_id 查出记录，再按主键 id 更新（update() 内部使用 get_by_id 按主键查询）
        record = await self.get_by_user_id(db, user_id)
        if record is None:
            return None
        return await self.update(db, record.id, {
            "last_sync_at": datetime.now(timezone.utc)
        })


# 导出单例
mail_account_repo = MailAccountRepository()