# backend/core/auth.py
"""
统一鉴权与上下文注入模块。

职责：
1. JWT Token 解析与校验
2. 从 Token 中提取 department_id 和 user_id
3. 提供 FastAPI Depends() 依赖注入函数

⚠️ 铁律：
- 鉴权逻辑必须抛出 401（未认证）或 403（无权限），禁止返回默认值
- SECRET_KEY 必须从 settings 获取，禁止硬编码
"""

import logging
from typing import Optional
from dataclasses import dataclass

import jwt
from jwt import PyJWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.core.config import settings

logger = logging.getLogger(__name__)

security_scheme = HTTPBearer(auto_error=False)


@dataclass
class UserContext:
    """从 JWT 中解析出的用户上下文"""
    user_id: str
    department_id: str
    roles: list[str]


def _decode_token(token: str) -> dict:
    """
    解码并校验 JWT Token。
    Raises:
        HTTPException 401: Token 无效、过期或签名不匹配
    """
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=["HS256"],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 已过期，请重新登录",
        )
    except PyJWTError as e:
        logger.warning(f"[Auth] JWT 解码失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的认证凭据",
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
) -> UserContext:
    """
    FastAPI 依赖注入：解析当前请求的 JWT Token 并返回 UserContext。

    用法：
        @router.get("/list")
        async def list_docs(user: UserContext = Depends(get_current_user)):
            department_id = user.department_id
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证凭据，请在 Header 中携带 Bearer Token",
        )

    payload = _decode_token(credentials.credentials)

    user_id = payload.get("sub")
    department_id = payload.get("department_id")
    roles = payload.get("roles", [])

    if not user_id or not department_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 中缺少必要字段 (sub / department_id)",
        )

    return UserContext(
        user_id=user_id,
        department_id=department_id,
        roles=roles,
    )


async def get_current_department_id(
    user: UserContext = Depends(get_current_user),
) -> str:
    """
    快捷依赖：仅返回 department_id。
    适用于不需要完整 UserContext 的场景。
    """
    return user.department_id


def require_role(required_role: str):
    """
    RBAC 角色守卫工厂。
    用法：
        @router.delete("/{doc_id}", dependencies=[Depends(require_role("admin"))])
    """
    async def _guard(user: UserContext = Depends(get_current_user)):
        if required_role not in user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要角色: {required_role}",
            )
        return user
    return _guard
