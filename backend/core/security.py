import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from backend.core.config import settings

ALGORITHM = settings.JWT_ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES


def hash_password(password: str) -> str:
    salt = secrets.token_hex(32)
    pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200000)
    return f"pbkdf2:sha256:200000${salt}${pwd_hash.hex()}"


def verify_password(plain_password: str, hashed: str) -> bool:
    try:
        parts = hashed.split("$")
        if len(parts) != 3:
            return False
        algorithm, salt, stored_hash = parts
        pwd_hash = hashlib.pbkdf2_hmac(
            algorithm.split(":")[1],
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            int(algorithm.split(":")[2]),
        )
        return pwd_hash.hex() == stored_hash
    except Exception:
        return False


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, "enterprise-ai-agent-secret-key-2024", algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, "enterprise-ai-agent-secret-key-2024", algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None