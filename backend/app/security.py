"""Password hashing and signed access tokens (stdlib only)."""
import base64, hashlib, hmac, json, os, time
from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session
from app.config import settings
from app.database import get_db
from app.models import User


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
        return hmac.compare_digest(hash_password(password, bytes.fromhex(salt_hex)).split("$")[1], dk_hex)
    except ValueError:
        return False


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def create_token(user: User) -> str:
    body = _b64(json.dumps({"uid": user.id, "exp": int(time.time()) + settings.token_ttl_minutes * 60}).encode())
    sig = _b64(hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str) -> int | None:
    try:
        body, sig = token.split(".")
        expected = _b64(hmac.new(settings.secret_key.encode(), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return data["uid"] if data["exp"] > time.time() else None
    except Exception:
        return None


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header (expected 'Bearer <token>').")
    uid = decode_token(authorization.split(" ", 1)[1].strip())
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "Invalid or expired token. Please log in again.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "This action requires the QA admin role.")
    return user
