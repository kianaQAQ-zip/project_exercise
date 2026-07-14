# backend/services/mail_service.py
import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from backend.modules.mail_handler import mail_handler, MailCredentials
from backend.core.llm_client import llm_router
from backend.core import database
from backend.repositories.mail_account_repo import mail_account_repo
from backend.repositories.mail_message_repo import mail_message_repo
from backend.models.db_models import MailMessage

logger = logging.getLogger(__name__)


# ================= Pydantic 强类型约束模型 =================

class MailClassification(BaseModel):
    """LLM 邮件分类结果约束"""
    summary: str = Field(description="邮件核心摘要，限50字")
    category: str = Field(description="分类: 'URGENT'(紧急), 'INQUIRY'(咨询), 'SPAM'(垃圾), 'NOTIFICATION'(通知)")
    confidence: float = Field(ge=0.0, le=1.0, description="置信度 0-1")
    reason: str = Field(description="分类理由，限20字以内")


class MailDraft(BaseModel):
    """LLM 生成的邮件草稿约束"""
    subject: str = Field(description="邮件主题")
    body: str = Field(description="邮件正文 (Markdown 格式)")
    tone: str = Field(description="语气: 'professional', 'friendly', 'apologetic'")


class MailService:
    """邮件 AI 助理核心编排服务"""

    async def _get_credentials(self, user_id: str) -> Optional[MailCredentials]:
        """从数据库获取用户的邮箱凭证"""
        if database.async_session_factory is None:
            logger.error("[MailService] 数据库未初始化，无法获取邮箱凭证")
            return None
        async with database.async_session_factory() as session:
            account = await mail_account_repo.get_by_user_id(session, user_id)
            if account is None:
                return None
            return MailCredentials(
                imap_host=account.imap_host,
                imap_port=account.imap_port,
                smtp_host=account.smtp_host,
                smtp_port=account.smtp_port,
                username=account.email_address,
                password=account.encrypted_password,
            )

    async def sync_recent_mails(
        self,
        user_id: str,
        days: int = 7,
        limit: int = 100,
    ) -> dict:
        """
        从 IMAP 同步最近 N 天内的邮件到数据库。
        - 拉取最近 N 天的邮件
        - 对每条邮件进行 AI 分析（分类 + 摘要）
        - 存入数据库（新邮件默认 is_read=False）
        - 清理超过 N 天的旧邮件
        """
        logger.info(f"[MailService] 开始同步用户 {user_id} 最近 {days} 天邮件")
        credentials = await self._get_credentials(user_id)
        if credentials is None:
            logger.warning(f"[MailService] 用户 {user_id} 未绑定邮箱")
            return {"synced": 0, "skipped": 0, "total": 0, "error": "未绑定邮箱"}

        # 拉取最近 N 天邮件
        raw_mails = await mail_handler.fetch_recent(
            credentials=credentials,
            days=days,
            limit=limit,
        )

        if not raw_mails:
            logger.info(f"[MailService] 用户 {user_id} 最近 {days} 天无新邮件")
            # 仍然执行清理
            if database.async_session_factory is not None:
                async with database.async_session_factory() as session:
                    await mail_message_repo.cleanup_old(session, user_id, days)
            return {"synced": 0, "skipped": 0, "total": 0, "message": "无新邮件"}

        # AI 分析
        tasks = [self._analyze_single_mail(mail) for mail in raw_mails]
        analyzed = await asyncio.gather(*tasks, return_exceptions=True)
        analyzed = [res for res in analyzed if isinstance(res, dict)]

        # 存入数据库
        synced = 0
        skipped = 0
        if database.async_session_factory is not None:
            async with database.async_session_factory() as session:
                for mail_data in analyzed:
                    existing = await mail_message_repo.get_by_uid(
                        session, user_id, mail_data["mail_uid"]
                    )
                    if existing:
                        # 更新已有邮件（可能摘要或分类有变化）
                        existing.summary = mail_data.get("summary", existing.summary)
                        existing.category = mail_data.get("category", existing.category)
                        existing.confidence = mail_data.get("confidence", existing.confidence)
                        skipped += 1
                    else:
                        # 解析邮件日期
                        mail_date = None
                        if mail_data.get("date"):
                            try:
                                from email.utils import parsedate_to_datetime
                                mail_date = parsedate_to_datetime(mail_data["date"])
                            except Exception:
                                pass

                        new_mail = MailMessage(
                            id=str(uuid4()),
                            user_id=user_id,
                            mail_uid=mail_data["mail_uid"],
                            sender=mail_data["sender"],
                            subject=mail_data["subject"],
                            body=mail_data["body"],
                            summary=mail_data.get("summary"),
                            category=mail_data.get("category", "UNKNOWN"),
                            confidence=mail_data.get("confidence", 0.0),
                            has_attachments=mail_data.get("has_attachments", False),
                            is_read=False,
                            mail_date=mail_date,
                            received_at=datetime.now(timezone.utc),
                        )
                        session.add(new_mail)
                        synced += 1

                await session.commit()

                # 清理超过 N 天的旧邮件
                await mail_message_repo.cleanup_old(session, user_id, days)

        logger.info(f"[MailService] 同步完成 | synced={synced} | skipped={skipped}")
        return {"synced": synced, "skipped": skipped, "total": synced + skipped}

    async def process_inbox_batch(self, user_id: str, limit: int = 10) -> List[dict]:
        """
        批量拉取并智能处理收件箱 (分类 + 摘要)
        优先使用用户绑定的邮箱凭证，否则使用默认配置
        """
        logger.info(f"[MailService] 开始为用户 {user_id} 处理最新 {limit} 封邮件")

        credentials = await self._get_credentials(user_id)
        if credentials is None:
            logger.warning(f"[MailService] 用户 {user_id} 未绑定邮箱，使用默认配置")

        raw_mails = await mail_handler.fetch_unseen(credentials=credentials, limit=limit)

        tasks = [self._analyze_single_mail(mail) for mail in raw_mails]
        processed_mails = await asyncio.gather(*tasks, return_exceptions=True)

        return [res for res in processed_mails if isinstance(res, dict)]

    async def _analyze_single_mail(self, raw_mail) -> dict:
        """单封邮件的 AI 分析管道"""
        content = raw_mail.body_text
        sender = raw_mail.sender

        prompt = f"""分析以下企业邮件，提取摘要并进行分类。
发件人: {sender}
邮件正文:
{content[:2000]}

请严格以 JSON 格式返回，包含以下字段：
1. "summary": 核心摘要 (限50字)
2. "category": 分类 (URGENT/INQUIRY/NOTIFICATION/SPAM/UNKNOWN)
3. "confidence": 置信度 0-1
4. "reason": 分类理由 (限20字)
"""

        try:
            ai_result = await llm_router.chat_completion_structured(
                messages=[{"role": "user", "content": prompt}],
                response_model=MailClassification,
                temperature=0.1,
            )

            return {
                "mail_uid": raw_mail.uid,
                "sender": sender,
                "subject": raw_mail.subject,
                "date": raw_mail.date,
                "body": raw_mail.body_text,
                "summary": ai_result.summary,
                "category": ai_result.category,
                "confidence": ai_result.confidence,
                "has_attachments": bool(raw_mail.attachments),
            }
        except Exception as e:
            logger.error(f"[MailService] 邮件 {raw_mail.uid} 分析失败: {e}")
            raise e

    async def generate_reply_draft(
            self,
            original_mail_id: str,
            user_instruction: str,
            user_id: str,
    ) -> MailDraft:
        """根据原邮件和用户指令，生成智能回复草稿"""
        # TODO: 实现获取原邮件详情的逻辑
        prompt = f"""你是一位专业的企业商务秘书。请根据用户指令撰写一封得体的回复邮件草稿。

【用户指令】: {user_instruction}

要求：
1. 语气必须符合企业商务规范。
2. 严格以 JSON 格式返回，包含 "subject"、"body" 和 "tone"。
"""

        draft = await llm_router.chat_completion_structured(
            messages=[{"role": "user", "content": prompt}],
            response_model=MailDraft,
            temperature=0.7,
        )

        logger.info(f"[MailService] 成功为邮件 {original_mail_id} 生成草稿")
        return draft


# 实例化单例供路由层调用
mail_service = MailService()