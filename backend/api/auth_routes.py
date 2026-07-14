from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.deps import get_current_active_user, require_admin
from backend.core.database import get_db
from backend.core.security import (
    create_access_token,
    verify_password,
)
from backend.models.db_models import User, UserRole

router = APIRouter(prefix="/api/auth", tags=["认证"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=1, max_length=256)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserInfo(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    role: str
    department: str | None


@router.post("/login", summary="用户登录")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户已被禁用，请联系管理员")

    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value},
        expires_delta=timedelta(minutes=480),
    )

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        user={
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "email": user.email,
            "role": user.role.value,
            "department": user.department,
        },
    )


@router.get("/me", summary="获取当前用户信息")
async def get_me(current_user: User = Depends(get_current_active_user)):
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        email=current_user.email,
        role=current_user.role.value,
        department=current_user.department,
    )


@router.get("/admin-check", summary="检查是否管理员")
async def admin_check(current_user: User = Depends(require_admin)):
    return {"is_admin": True, "message": "管理员权限验证通过"}


class UpdateProfileRequest(BaseModel):
    email: str | None = Field(default=None, max_length=255)
    display_name: str | None = Field(default=None, max_length=128)


@router.put("/profile", summary="更新当前用户个人信息")
async def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户的邮箱和显示名称"""
    if body.email is not None:
        # 检查邮箱是否已被其他用户使用
        result = await db.execute(
            select(User).where(User.email == body.email, User.id != current_user.id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已被其他用户使用")
        current_user.email = body.email.strip()
    if body.display_name is not None:
        current_user.display_name = body.display_name.strip()
    await db.commit()
    await db.refresh(current_user)
    return UserInfo(
        id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        email=current_user.email,
        role=current_user.role.value,
        department=current_user.department,
    )