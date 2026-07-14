# backend/repositories/conversation_repo.py
import logging
from typing import List, Optional, Tuple

from sqlalchemy import select, func, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.db_models import Conversation

logger = logging.getLogger(__name__)


class ConversationRepo:
    """对话记录数据访问层"""

    MAX_CONVERSATIONS = 8  # 最多保留 8 条非星标对话

    async def create(self, db: AsyncSession, session_id: str, user_id: str, title: str = "新对话") -> Conversation:
        """创建新对话记录，并自动清理超过 8 条的非星标旧对话"""
        conv = Conversation(
            session_id=session_id,
            user_id=user_id,
            title=title,
        )
        db.add(conv)
        await db.flush()

        # 自动清理：删除超过 8 条的非星标对话
        await self._auto_cleanup(db, user_id)

        await db.commit()
        await db.refresh(conv)
        return conv

    async def _auto_cleanup(self, db: AsyncSession, user_id: str) -> None:
        """清理用户最旧的非星标对话，确保总数不超过 8 条"""
        # 统计非星标对话数量
        count_result = await db.execute(
            select(func.count(Conversation.id))
            .where(Conversation.user_id == user_id, Conversation.starred == False)
        )
        count = count_result.scalar_one()

        if count > self.MAX_CONVERSATIONS:
            # 获取最旧的非星标对话，删除超出部分
            excess = count - self.MAX_CONVERSATIONS
            to_delete = await db.execute(
                select(Conversation.id)
                .where(Conversation.user_id == user_id, Conversation.starred == False)
                .order_by(Conversation.created_at.asc())
                .limit(excess)
            )
            delete_ids = [row[0] for row in to_delete.all()]
            if delete_ids:
                await db.execute(
                    delete(Conversation).where(Conversation.id.in_(delete_ids))
                )
                logger.info(f"[ConversationRepo] 自动清理 {len(delete_ids)} 条旧对话 (user_id={user_id})")

    async def list_by_user(self, db: AsyncSession, user_id: str) -> List[Conversation]:
        """获取用户的所有对话记录，按更新时间倒序，星标置顶"""
        result = await db.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.starred.desc(), Conversation.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_by_session_id(self, db: AsyncSession, session_id: str) -> Optional[Conversation]:
        """根据 session_id 查找对话"""
        result = await db.execute(
            select(Conversation).where(Conversation.session_id == session_id)
        )
        return result.scalar_one_or_none()

    async def update_title(self, db: AsyncSession, session_id: str, title: str) -> bool:
        """更新对话标题"""
        result = await db.execute(
            update(Conversation)
            .where(Conversation.session_id == session_id)
            .values(title=title, updated_at=Conversation.updated_at)
        )
        return result.rowcount > 0

    async def increment_message_count(self, db: AsyncSession, session_id: str) -> bool:
        """消息计数 +1"""
        result = await db.execute(
            update(Conversation)
            .where(Conversation.session_id == session_id)
            .values(message_count=Conversation.message_count + 1, updated_at=Conversation.updated_at)
        )
        return result.rowcount > 0

    async def toggle_star(self, db: AsyncSession, session_id: str) -> Optional[Conversation]:
        """切换星标状态"""
        conv = await self.get_by_session_id(db, session_id)
        if conv:
            new_starred = not conv.starred
            await db.execute(
                update(Conversation)
                .where(Conversation.session_id == session_id)
                .values(starred=new_starred, updated_at=Conversation.updated_at)
            )
            await db.commit()
            conv.starred = new_starred
        return conv

    async def delete(self, db: AsyncSession, session_id: str) -> bool:
        """删除对话记录"""
        result = await db.execute(
            delete(Conversation).where(Conversation.session_id == session_id)
        )
        await db.commit()
        return result.rowcount > 0


# 全局单例
conversation_repo = ConversationRepo()