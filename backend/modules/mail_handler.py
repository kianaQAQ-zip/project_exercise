# backend/modules/mail_handler.py
import logging
import email
from email import policy
from email.message import EmailMessage
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import aioimaplib
import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from backend.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class MailAttachment:
    """标准化附件结构"""
    filename: str
    content_type: str
    payload: bytes
    size_bytes: int


@dataclass
class ParsedMail:
    """标准化邮件解析结果"""
    uid: str
    subject: str
    sender: str
    date: str
    body_text: str
    attachments: List[MailAttachment]


@dataclass
class MailCredentials:
    """邮箱认证凭证（动态传入）"""
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    username: str
    password: str


class EnterpriseMailHandler:
    """
    企业级异步邮件收发处理器。
    核心能力：IMAP 增量拉取、MIME 安全解析、SMTP 加密发送、附件二进制提取。
    支持动态传入邮箱凭证（多用户模式）。
    """

    def __init__(self):
        # 保留默认配置（向后兼容单账号模式）
        self._default_creds = MailCredentials(
            imap_host=settings.MAIL.imap_host,
            imap_port=settings.MAIL.imap_port,
            smtp_host=settings.MAIL.smtp_host,
            smtp_port=settings.MAIL.smtp_port,
            username=settings.MAIL.username,
            password=settings.MAIL.password,
        )
        logger.info(f"📧 MailHandler 初始化 | 默认 IMAP={self._default_creds.imap_host}:{self._default_creds.imap_port}")

    # ==================== IMAP 收件 ====================

    async def _fetch_parsed_mails(
        self,
        conn: aioimaplib.IMAP4_SSL,
        seq_nums: List[bytes],
        limit: int,
        mark_seen: bool = False,
    ) -> List[ParsedMail]:
        """解析邮件序列号列表，返回 ParsedMail 列表"""
        seq_nums = sorted(seq_nums, key=lambda x: int(x), reverse=True)[:limit]
        parsed_mails: List[ParsedMail] = []

        for seq_num in seq_nums:
            seq_str = seq_num.decode() if isinstance(seq_num, bytes) else str(seq_num)
            try:
                raw = await self._fetch_raw(conn, seq_str, use_uid=False)
                if raw:
                    parsed = self._parse_mime(raw, seq_str)
                    parsed_mails.append(parsed)
                    if mark_seen:
                        await conn.store(seq_str, '+FLAGS', '\\Seen')
            except Exception as e:
                logger.error(f"[MailHandler] 解析邮件 SEQ={seq_str} 失败: {e}", exc_info=True)
                continue

        return parsed_mails

    async def fetch_unseen(
        self,
        credentials: Optional[MailCredentials] = None,
        folder: str = "INBOX",
        limit: int = 50,
        mark_seen: bool = False,
    ) -> List[ParsedMail]:
        """
        拉取未读邮件。
        
        Args:
            credentials: 邮箱认证凭证（可选，不传则使用默认配置）
            folder: 邮箱文件夹
            limit: 单次最大拉取数量
            mark_seen: 是否标记为已读（默认 False，保留未读状态）
        Returns:
            解析后的邮件列表
        """
        creds = credentials or self._default_creds
        conn = None
        try:
            conn = aioimaplib.IMAP4_SSL(host=creds.imap_host, port=creds.imap_port)
            await conn.wait_hello_from_server()
            await conn.login(creds.username, creds.password)
            await conn.select(folder)

            # 搜索未读邮件
            status, data = await conn.search('(UNSEEN)')
            if status != "OK" or not data or not data[0]:
                logger.info(f"[MailHandler] {folder} 无未读邮件")
                return []

            parsed_mails = await self._fetch_parsed_mails(conn, data[0].split(), limit, mark_seen)
            logger.info(f"[MailHandler] 拉取未读邮件完成 | folder={folder} | count={len(parsed_mails)}")
            return parsed_mails

        except Exception as e:
            logger.error(f"[MailHandler] IMAP 连接/搜索异常: {e}", exc_info=True)
            return []
        finally:
            if conn:
                try:
                    await conn.logout()
                except Exception:
                    pass

    async def fetch_recent(
        self,
        credentials: Optional[MailCredentials] = None,
        folder: str = "INBOX",
        days: int = 7,
        limit: int = 100,
    ) -> List[ParsedMail]:
        """
        拉取最近 N 天内的所有邮件（不标记已读）。
        
        Args:
            credentials: 邮箱认证凭证
            folder: 邮箱文件夹
            days: 拉取最近多少天的邮件
            limit: 单次最大拉取数量
        Returns:
            解析后的邮件列表
        """
        creds = credentials or self._default_creds
        conn = None
        try:
            conn = aioimaplib.IMAP4_SSL(host=creds.imap_host, port=creds.imap_port)
            await conn.wait_hello_from_server()
            await conn.login(creds.username, creds.password)
            await conn.select(folder)

            # 计算 N 天前的日期（IMAP 格式: DD-Mon-YYYY）
            since_date = (datetime.now() - timedelta(days=days)).strftime("%d-%b-%Y")

            # 搜索 SINCE 指定日期之后的所有邮件
            status, data = await conn.search(f'(SINCE "{since_date}")')
            if status != "OK":
                logger.warning(f"[MailHandler] 搜索最近 {days} 天邮件失败: {status}")
                return []

            if not data or not data[0]:
                logger.info(f"[MailHandler] 最近 {days} 天无邮件")
                return []

            parsed_mails = await self._fetch_parsed_mails(conn, data[0].split(), limit, mark_seen=False)
            logger.info(f"[MailHandler] 拉取最近 {days} 天邮件完成 | count={len(parsed_mails)}")
            return parsed_mails

        except Exception as e:
            logger.error(f"[MailHandler] 拉取最近 {days} 天邮件异常: {e}", exc_info=True)
            return []
        finally:
            if conn:
                try:
                    await conn.logout()
                except Exception:
                    pass

    async def _fetch_raw(self, conn: aioimaplib.IMAP4_SSL, uid: str, use_uid: bool = True) -> Optional[bytes]:
        """获取单封邮件原始 RFC822 数据"""
        if use_uid:
            status, data = await conn.uid('fetch', uid, '(RFC822)')
        else:
            status, data = await conn.fetch(uid, '(RFC822)')
        if status == "OK" and data and len(data) >= 2:
            return data[1]
        return None

    @staticmethod
    def _parse_mime(raw: bytes, uid: str) -> ParsedMail:
        """
        安全解析 MIME 消息。
        使用 email.policy.default 自动处理 base64/quoted-printable 解码及 charset 转换。
        """
        msg = email.message_from_bytes(raw, policy=policy.default)

        # 提取正文（优先纯文本，降级 HTML）
        body_text = ""
        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct == "text/plain":
                    body_text = part.get_content()
                    break
            if not body_text:
                for part in msg.walk():
                    if part.get_content_type() == "text/html":
                        body_text = part.get_content()
                        break
        else:
            body_text = msg.get_content()

        # 提取附件
        attachments: List[MailAttachment] = []
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_disposition() == "attachment":
                    fname = part.get_filename() or "unnamed_attachment"
                    payload = part.get_payload(decode=True) or b""
                    attachments.append(MailAttachment(
                        filename=fname,
                        content_type=part.get_content_type(),
                        payload=payload,
                        size_bytes=len(payload),
                    ))

        return ParsedMail(
            uid=uid,
            subject=str(msg.get("Subject", "")),
            sender=str(msg.get("From", "")),
            date=str(msg.get("Date", "")),
            body_text=body_text.strip(),
            attachments=attachments,
        )

    # ==================== SMTP 发件 ====================

    async def send(
        self,
        to_addrs: List[str],
        subject: str,
        body_html: str,
        credentials: Optional[MailCredentials] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> bool:
        """
        发送邮件（支持 HTML 正文 + 多附件）。
        
        Args:
            to_addrs: 收件人列表
            subject: 主题
            body_html: HTML 格式正文
            credentials: 邮箱认证凭证（可选，不传则使用默认配置）
            attachments: [{"filename": "report.pdf", "content": bytes}]
        Returns:
            是否发送成功
        """
        creds = credentials or self._default_creds
        try:
            msg = MIMEMultipart("mixed")
            msg["From"] = creds.username
            msg["To"] = ", ".join(to_addrs)
            msg["Subject"] = subject

            # HTML 正文
            msg.attach(MIMEText(body_html, "html", "utf-8"))

            # 附件
            for att in (attachments or []):
                mime_att = MIMEBase("application", "octet-stream")
                mime_att.set_payload(att["content"])
                encoders.encode_base64(mime_att)
                mime_att.add_header("Content-Disposition", f'attachment; filename="{att["filename"]}"')
                msg.attach(mime_att)

            await aiosmtplib.send(
                msg,
                hostname=creds.smtp_host,
                port=creds.smtp_port,
                username=creds.username,
                password=creds.password,
                use_tls=True,
            )
            logger.info(f"[MailHandler] 发送成功 | from={creds.username} | to={to_addrs} | subject='{subject}'")
            return True

        except Exception as e:
            logger.error(f"[MailHandler] 发送失败 | from={creds.username} | to={to_addrs} | {e}", exc_info=True)
            return False


# 导出全局单例
mail_handler = EnterpriseMailHandler()