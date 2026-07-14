# backend/repositories/mail_message_repo.py
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db_models import MailMessage

logger = logging.getLogger(__name__)


class MailMessageRepository:
    """邮件消息仓库"""

    async def get_by_uid(self, db: AsyncSession, user_id: str, mail_uid: str) -> Optional[MailMessage]:
        """根据 IMAP UID 查找已存在的邮件"""
        result = await db.execute(
            select(MailMessage).where(
                MailMessage.user_id == user_id,
                MailMessage.mail_uid == mail_uid,
            )
        )
        return result.scalar_one_or_none()

    async def list_by_user(
        self,
        db: AsyncSession,
        user_id: str,
        is_read: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[MailMessage], int]:
        """分页获取用户的邮件列表，可按已读/未读筛选"""
        conditions = [MailMessage.user_id == user_id]
        if is_read is not None:
            conditions.append(MailMessage.is_read == is_read)

        count_q = select(func.count(MailMessage.id)).where(*conditions)
        total_result = await db.execute(count_q)
        total = total_result.scalar() or 0

        q = (
            select(MailMessage)
            .where(*conditions)
            .order_by(MailMessage.mail_date.desc().nullslast(), MailMessage.received_at.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(q)
        return list(result.scalars().all()), total

    async def mark_as_read(self, db: AsyncSession, mail_id: str) -> bool:
        """标记单封邮件为已读"""
        result = await db.execute(
            update(MailMessage)
            .where(MailMessage.id == mail_id)
            .values(is_read=True)
        )
        await db.commit()
        return result.rowcount > 0

    async def mark_all_as_read(self, db: AsyncSession, user_id: str) -> int:
        """标记用户所有邮件为已读"""
        result = await db.execute(
            update(MailMessage)
            .where(MailMessage.user_id == user_id, MailMessage.is_read == False)
            .values(is_read=True)
        )
        await db.commit()
        return result.rowcount

    async def get_unread_count(self, db: AsyncSession, user_id: str) -> int:
        """获取未读邮件数量"""
        result = await db.execute(
            select(func.count(MailMessage.id)).where(
                MailMessage.user_id == user_id,
                MailMessage.is_read == False,
            )
        )
        return result.scalar() or 0

    async def save(self, db: AsyncSession, mail: MailMessage) -> MailMessage:
        """保存邮件（新增或更新）"""
        db.add(mail)
        await db.commit()
        await db.refresh(mail)
        return mail

    async def cleanup_old(self, db: AsyncSession, user_id: str, days: int = 7) -> int:
        """清理超过指定天数的邮件"""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await db.execute(
            delete(MailMessage).where(
                MailMessage.user_id == user_id,
                MailMessage.mail_date < cutoff,
            )
        )
        await db.commit()
        deleted = result.rowcount
        if deleted:
            logger.info(f"[MailRepo] 清理了 {deleted} 封超过 {days} 天的旧邮件")
        return deleted

    async def get_category_counts(self, db: AsyncSession, user_id: str) -> dict:
        """获取各分类的邮件数量统计"""
        result = await db.execute(
            select(MailMessage.category, func.count(MailMessage.id))
            .where(MailMessage.user_id == user_id)
            .group_by(MailMessage.category)
        )
        counts = {}
        for row in result.all():
            cat = row[0] or "UNKNOWN"
            counts[cat] = row[1]
        return counts


mail_message_repo = MailMessageRepository()