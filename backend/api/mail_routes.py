# backend/api/mail_routes.py
import logging
from fastapi import APIRouter, HTTPException, Body, Depends, Query
from pydantic import BaseModel, Field
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from backend.services.mail_service import mail_service
from backend.modules.mail_handler import mail_handler
from backend.core.database import get_db
from backend.repositories.mail_account_repo import mail_account_repo
from backend.repositories.mail_message_repo import mail_message_repo
from backend.models.db_models import UserMailAccount
from backend.core.llm_client import llm_router

logger = logging.getLogger(__name__)
router = APIRouter()


class MailItem(BaseModel):
    id: str
    sender: str
    subject: str
    category: str
    summary: str
    body: str = ""
    draft_reply: Optional[str] = None
    received_at: str
    confidence: float = 0.0
    has_attachments: bool = False
    is_read: bool = False


class SendMailRequest(BaseModel):
    to: str = Field(..., description="收件人邮箱")
    subject: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    original_mail_id: Optional[str] = Field(None, description="如果是回复邮件，传入原邮件ID")


def _mail_to_item(mail) -> MailItem:
    """将 DB 模型转为 API 响应模型"""
    return MailItem(
        id=mail.id,
        sender=mail.sender,
        subject=mail.subject,
        category=mail.category or "UNKNOWN",
        summary=mail.summary or "",
        body=mail.body or "",
        received_at=str(mail.mail_date or mail.received_at),
        confidence=mail.confidence or 0.0,
        has_attachments=mail.has_attachments or False,
        is_read=mail.is_read,
    )


# ================= 邮件同步 =================

@router.post("/sync", summary="从邮箱同步最近7天邮件")
async def sync_mails(
    user_id: str = "default_user",
    days: int = Query(7, description="同步最近多少天的邮件"),
    db: AsyncSession = Depends(get_db),
):
    """触发从 IMAP 同步邮件到数据库，并执行 AI 分析"""
    try:
        result = await mail_service.sync_recent_mails(user_id=user_id, days=days)
        return {"code": 200, "message": "同步完成", "data": result}
    except Exception as e:
        logger.error(f"[Mail API] 同步失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="邮件同步失败")


# ================= 邮件列表（从数据库读取） =================

@router.get("/inbox", summary="获取收件箱（从数据库）")
async def fetch_inbox(
    user_id: str = "default_user",
    is_read: Optional[bool] = Query(None, description="筛选已读/未读，不传则返回全部"),
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """获取数据库中的邮件列表，支持按已读/未读筛选"""
    try:
        items, total = await mail_message_repo.list_by_user(
            db, user_id=user_id, is_read=is_read, limit=limit, offset=offset,
        )
        return {
            "code": 200,
            "message": "success",
            "data": [_mail_to_item(m) for m in items],
            "total": total,
        }
    except Exception as e:
        logger.error(f"[Mail API] 获取收件箱失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="获取收件箱失败")


@router.get("/unread-count", summary="获取未读邮件数量")
async def get_unread_count(user_id: str = "default_user", db: AsyncSession = Depends(get_db)):
    """获取未读邮件数量，用于前端通知徽章"""
    try:
        count = await mail_message_repo.get_unread_count(db, user_id)
        return {"code": 200, "data": {"count": count}}
    except Exception as e:
        logger.error(f"[Mail API] 获取未读数量失败: {e}")
        return {"code": 200, "data": {"count": 0}}


# ================= 已读/未读状态管理 =================

@router.patch("/{mail_id}/read", summary="标记单封邮件为已读")
async def mark_as_read(mail_id: str, db: AsyncSession = Depends(get_db)):
    """将指定邮件标记为已读"""
    try:
        ok = await mail_message_repo.mark_as_read(db, mail_id)
        if not ok:
            raise HTTPException(status_code=404, detail="邮件不存在")
        return {"code": 200, "message": "已标记为已读"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Mail API] 标记已读失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="标记已读失败")


@router.patch("/read-all", summary="全部标记为已读")
async def mark_all_as_read(
    user_id: str = "default_user",
    db: AsyncSession = Depends(get_db),
):
    """将用户所有未读邮件标记为已读"""
    try:
        count = await mail_message_repo.mark_all_as_read(db, user_id)
        return {"code": 200, "message": f"已标记 {count} 封邮件为已读", "data": {"count": count}}
    except Exception as e:
        logger.error(f"[Mail API] 全部标记已读失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="操作失败")


# ================= 发送邮件 =================

@router.post("/send", summary="发送邮件")
async def send_mail(request: SendMailRequest):
    """发送新邮件或回复邮件"""
    try:
        success = await mail_handler.send(
            to_addrs=[request.to],
            subject=request.subject,
            body_html=request.body,
        )
        if not success:
            raise HTTPException(status_code=500, detail="邮件发送失败")
        return {"code": 200, "message": "邮件发送成功"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Mail API] 发送邮件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="邮件发送失败")


class ReclassifyRequest(BaseModel):
    mail_id: str = Field(..., description="邮件 ID")
    new_category: str = Field(..., description="新分类标签")


@router.post("/classify", summary="手动重新分类邮件")
async def reclassify_mail(request: ReclassifyRequest):
    """用户对 AI 分类不满意时，支持手动修正"""
    valid_categories = {"URGENT", "NEED_REPLY", "NORMAL", "SPAM"}
    if request.new_category not in valid_categories:
        raise HTTPException(status_code=400, detail=f"无效的分类标签，仅允许: {valid_categories}")

    try:
        return {"message": f"邮件 {request.mail_id} 已更新为 {request.new_category}"}
    except Exception as e:
        logger.error(f"[Mail API] 重新分类失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="重新分类失败")


# ================= 邮箱账户管理 =================

class MailAccountRequest(BaseModel):
    user_id: str = Field(..., description="用户 ID")
    provider: str = Field(..., description="邮箱服务商: qq, 163, gmail, outlook")
    email_address: str = Field(..., description="完整邮箱地址")
    password: str = Field(..., description="IMAP/SMTP 授权码（非邮箱登录密码）")
    imap_host: Optional[str] = Field(None, description="IMAP 服务器（可选，自动推断）")
    imap_port: Optional[int] = Field(None, description="IMAP 端口（可选，自动推断）")
    smtp_host: Optional[str] = Field(None, description="SMTP 服务器（可选，自动推断）")
    smtp_port: Optional[int] = Field(None, description="SMTP 端口（可选，自动推断）")


PROVIDER_CONFIG = {
    "qq": {"imap_host": "imap.qq.com", "imap_port": 993, "smtp_host": "smtp.qq.com", "smtp_port": 465},
    "163": {"imap_host": "imap.163.com", "imap_port": 993, "smtp_host": "smtp.163.com", "smtp_port": 465},
    "gmail": {"imap_host": "imap.gmail.com", "imap_port": 993, "smtp_host": "smtp.gmail.com", "smtp_port": 465},
    "outlook": {"imap_host": "outlook.office365.com", "imap_port": 993, "smtp_host": "smtp.office365.com", "smtp_port": 587},
}


@router.post("/account", summary="绑定邮箱账户")
async def bind_mail_account(request: MailAccountRequest, db: AsyncSession = Depends(get_db)):
    """绑定或更新用户的邮箱账户"""
    provider_info = PROVIDER_CONFIG.get(request.provider)
    if provider_info is None:
        raise HTTPException(status_code=400, detail=f"不支持的邮箱服务商: {request.provider}，支持: {list(PROVIDER_CONFIG.keys())}")

    existing = await mail_account_repo.get_by_user_id(db, request.user_id)
    if existing:
        update_data = {
            "provider": request.provider,
            "email_address": request.email_address,
            "imap_host": request.imap_host or provider_info["imap_host"],
            "imap_port": request.imap_port or provider_info["imap_port"],
            "smtp_host": request.smtp_host or provider_info["smtp_host"],
            "smtp_port": request.smtp_port or provider_info["smtp_port"],
            "encrypted_password": request.password,
        }
        await mail_account_repo.update(db, existing.id, update_data)
        await db.commit()
        return {"message": "邮箱账户已更新", "account_id": existing.id}

    new_account = UserMailAccount(
        user_id=request.user_id,
        provider=request.provider,
        email_address=request.email_address,
        imap_host=request.imap_host or provider_info["imap_host"],
        imap_port=request.imap_port or provider_info["imap_port"],
        smtp_host=request.smtp_host or provider_info["smtp_host"],
        smtp_port=request.smtp_port or provider_info["smtp_port"],
        encrypted_password=request.password,
    )
    db.add(new_account)
    await db.commit()
    await db.refresh(new_account)

    return {"message": "邮箱账户绑定成功", "account_id": new_account.id}


@router.get("/account/{user_id}", summary="查询邮箱账户")
async def get_mail_account(user_id: str, db: AsyncSession = Depends(get_db)):
    """查询用户绑定的邮箱账户信息"""
    account = await mail_account_repo.get_by_user_id(db, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="未绑定邮箱账户")
    return {
        "id": account.id,
        "user_id": account.user_id,
        "provider": account.provider,
        "email_address": account.email_address,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "smtp_host": account.smtp_host,
        "smtp_port": account.smtp_port,
        "is_active": account.is_active,
        "last_sync_at": str(account.last_sync_at) if account.last_sync_at else None,
    }


@router.delete("/account/{user_id}", summary="解绑邮箱账户")
async def unbind_mail_account(user_id: str, db: AsyncSession = Depends(get_db)):
    """解绑用户的邮箱账户"""
    account = await mail_account_repo.get_by_user_id(db, user_id)
    if account is None:
        raise HTTPException(status_code=404, detail="未绑定邮箱账户")
    await mail_account_repo.delete(db, account.id)
    await db.commit()
    return {"message": "邮箱账户已解绑"}


# ================= AI 邮件起草 =================

class DraftRequest(BaseModel):
    to: str = Field(..., description="收件人邮箱")
    subject: str = Field(..., min_length=1, description="邮件主题")
    context: Optional[str] = Field(None, description="额外上下文或要求，如语气、要点等")


class AnalyzeRequest(BaseModel):
    subject: str = Field(..., description="邮件主题")
    sender: str = Field(..., description="发件人")
    body: str = Field(..., description="邮件正文")


class DraftReplyRequest(BaseModel):
    original_subject: str = Field(..., description="原邮件主题")
    original_body: str = Field(..., description="原邮件正文")
    original_sender: str = Field(..., description="原邮件发件人")
    topic: str = Field(..., min_length=1, description="回复主题")
    context: Optional[str] = Field(None, description="补充要求，如语气、要点等")


ANALYZE_SYSTEM_PROMPT = """你是一位资深的企业邮件分析师。请仔细阅读邮件内容，提供以下分析：

1. **核心意图**: 一句话概括发件人的核心诉求
2. **关键信息**: 提取邮件中的关键数据、日期、金额、人名等
3. **紧急程度**: 评估紧急程度（高/中/低）并说明理由
4. **建议行动**: 给出3条具体的后续行动建议
5. **情感倾向**: 判断邮件情感（积极/中性/消极/紧急）

请以 JSON 格式返回，包含以下字段：
- "intent": 核心意图
- "key_info": 关键信息列表
- "urgency": 紧急程度
- "urgency_reason": 紧急程度理由
- "actions": 建议行动列表
- "sentiment": 情感倾向"""


REPLY_SYSTEM_PROMPT = """你是一位专业的商务邮件撰写助手。请根据原邮件内容和用户要求，撰写一封专业得体的回复邮件。

要求：
1. 使用正式、礼貌的商务语气
2. 邮件结构清晰：称呼、正文、结束语、署名
3. 署名使用"此致\n敬礼"或"祝好"等得体措辞
4. 正文简洁明了，段落分明
5. 必须针对原邮件内容进行回复，体现你已认真阅读
6. 仅返回邮件正文纯文本，不要包含任何 JSON 包装或元信息"""


@router.post("/analyze", summary="AI 详细分析单封邮件")
async def analyze_mail(request: AnalyzeRequest):
    """当用户打开邮件详情时，AI 同步进行深度分析"""
    try:
        user_prompt = f"""发件人: {request.sender}
主题: {request.subject}

邮件正文:
{request.body[:3000]}"""

        messages = [
            {"role": "system", "content": ANALYZE_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        result = await llm_router.chat_completion(messages, temperature=0.3)
        return {"code": 200, "message": "分析完成", "data": {"analysis": result.strip()}}
    except Exception as e:
        logger.error(f"[Mail API] AI 分析邮件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="AI 分析邮件失败，请稍后重试")


@router.post("/draft-reply", summary="AI 起草回复邮件（基于原邮件内容）")
async def generate_draft_reply(request: DraftReplyRequest):
    """根据原邮件内容 + 用户主题/要求，AI 起草回复草稿"""
    try:
        user_prompt = f"""【原邮件发件人】: {request.original_sender}
【原邮件主题】: {request.original_subject}
【原邮件正文】:
{request.original_body[:2500]}

【用户要求的回复主题】: {request.topic}"""
        if request.context:
            user_prompt += f"\n【补充要求】: {request.context}"
        user_prompt += "\n\n请撰写回复邮件正文。"

        messages = [
            {"role": "system", "content": REPLY_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        body = await llm_router.chat_completion(messages, temperature=0.7)
        return {
            "code": 200,
            "message": "回复草稿已生成",
            "data": {"to": request.original_sender, "subject": f"Re: {request.topic}", "body": body.strip()},
        }
    except Exception as e:
        logger.error(f"[Mail API] AI 起草回复失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="AI 起草回复失败，请稍后重试")


class DraftResponse(BaseModel):
    to: str
    subject: str
    body: str


DRAFT_SYSTEM_PROMPT = """你是一位专业的商务邮件撰写助手。请根据用户提供的收件人、主题和上下文，撰写一封专业得体的邮件正文。

要求：
1. 使用正式、礼貌的商务语气
2. 邮件结构清晰：称呼、正文、结束语、署名
3. 署名使用"此致\n敬礼"或"祝好"等得体措辞
4. 正文简洁明了，段落分明
5. 不要使用任何占位符，所有内容应完整可发送
6. 仅返回邮件正文纯文本，不要包含任何 JSON 包装或元信息"""


@router.post("/draft", summary="AI 起草邮件草稿")
async def generate_draft(request: DraftRequest):
    """使用 AI 生成邮件草稿，用户在发送前可修改"""
    try:
        user_prompt = f"收件人: {request.to}\n主题: {request.subject}"
        if request.context:
            user_prompt += f"\n额外要求: {request.context}"
        user_prompt += "\n\n请撰写邮件正文。"

        messages = [
            {"role": "system", "content": DRAFT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        body = await llm_router.chat_completion(messages, temperature=0.7)
        return {
            "code": 200,
            "message": "草稿已生成",
            "data": {"to": request.to, "subject": request.subject, "body": body.strip()},
        }

    except Exception as e:
        logger.error(f"[Mail API] AI 起草邮件失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="AI 起草邮件失败，请稍后重试")