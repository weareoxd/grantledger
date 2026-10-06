"""
Stateless JWT access and refresh tokens for the MCP OAuth server.

Tokens are signed with the Django SECRET_KEY (HS256) and self-describing, so any
uvicorn worker can verify them without shared storage. Revocation and rotation use
a small jti denylist (OAuthRevokedToken); access tokens are short-lived, so their
denylist entries expire quickly.
"""

import time
import uuid

import jwt
from django.conf import settings

ALGORITHM = "HS256"


def _now():
    return int(time.time())


def _encode(payload):
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode(token):
    """Decode and verify a token. Raises jwt.PyJWTError on any problem."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], options={"verify_aud": False})


def mint_access_token(*, user_id, email, client_id, scopes, resource=None):
    exp = _now() + int(settings.MCP_ACCESS_TOKEN_TTL)
    jti = str(uuid.uuid4())
    payload = {
        "typ": "access",
        "sub": str(user_id),
        "email": email,
        "client_id": client_id,
        "scope": " ".join(scopes or []),
        "iss": settings.MCP_PUBLIC_URL,
        "aud": resource or f"{settings.MCP_PUBLIC_URL}/mcp",
        "iat": _now(),
        "exp": exp,
        "jti": jti,
    }
    return _encode(payload), exp, jti


def mint_refresh_token(*, user_id, email, client_id, scopes):
    exp = _now() + int(settings.MCP_REFRESH_TOKEN_TTL_DAYS) * 86400
    jti = str(uuid.uuid4())
    payload = {
        "typ": "refresh",
        "sub": str(user_id),
        "email": email,
        "client_id": client_id,
        "scope": " ".join(scopes or []),
        "iss": settings.MCP_PUBLIC_URL,
        "iat": _now(),
        "exp": exp,
        "jti": jti,
    }
    return _encode(payload), exp, jti
