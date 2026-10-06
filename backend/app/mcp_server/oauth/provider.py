"""
OAuth 2.1 Authorization Server provider that federates to Google.

The MCP client (claude.ai, ChatGPT, Claude Desktop) is the OAuth *client*; this
provider is the Authorization Server. Human login is delegated to Google
(google_flow.py); on success we provision the user (domain-restricted) and issue
our own stateless JWTs (tokens.py). ORM access runs through sync_to_async because
the provider lives in MCP's async event loop.
"""

import hmac
import secrets
import time
from datetime import timedelta

import jwt
from asgiref.sync import sync_to_async
from django.conf import settings
from django.utils import timezone
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl

from app.account.models import User
from app.mcp_server.models import OAuthAuthorizationRequest, OAuthClient, OAuthRevokedToken
from app.mcp_server.oauth import google_flow, tokens

AUTH_REQUEST_TTL = timedelta(minutes=10)


def _get_client(client_id):
    row = OAuthClient.objects.filter(pk=client_id).first()
    return row.data if row else None


def _save_client(client_id, data):
    OAuthClient.objects.update_or_create(client_id=client_id, defaults={"data": data})


def _create_request(**fields):
    return OAuthAuthorizationRequest.objects.create(**fields)


def _get_request_by_code(code):
    return OAuthAuthorizationRequest.objects.filter(code=code).first()


def _is_revoked(jti):
    return OAuthRevokedToken.objects.filter(pk=jti).exists()


def _revoke(jti, expires_at):
    OAuthRevokedToken.objects.get_or_create(jti=jti, defaults={"expires_at": expires_at})


def _user_email(user_id):
    user = User.objects.filter(pk=user_id, is_active=True).first()
    return user.email if user else None


class GrantLedgerOAuthProvider(OAuthAuthorizationServerProvider):
    # --- Dynamic client registration ------------------------------------
    async def get_client(self, client_id):
        data = await sync_to_async(_get_client)(client_id)
        return OAuthClientInformationFull(**data) if data else None

    async def register_client(self, client_info: OAuthClientInformationFull):
        await sync_to_async(_save_client)(client_info.client_id, client_info.model_dump(mode="json"))

    # --- Authorization: redirect the user up to Google ------------------
    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        code_verifier = secrets.token_urlsafe(64)
        authorization_url, google_state = await sync_to_async(google_flow.build_authorization_url)(
            code_verifier
        )
        await sync_to_async(_create_request)(
            client_id=client.client_id,
            redirect_uri=str(params.redirect_uri),
            redirect_uri_provided_explicitly=params.redirect_uri_provided_explicitly,
            code_challenge=params.code_challenge,
            scopes=list(params.scopes or []),
            resource=params.resource,
            mcp_state=params.state,
            google_state=google_state,
            google_code_verifier=code_verifier,
            expires_at=timezone.now() + AUTH_REQUEST_TTL,
        )
        return authorization_url

    # --- Authorization code (issued by the Google callback) -------------
    async def load_authorization_code(self, client, authorization_code):
        req = await sync_to_async(_get_request_by_code)(authorization_code)
        if (
            req is None
            or req.used
            or req.user_id is None
            or req.client_id != client.client_id
            or req.expires_at < timezone.now()
        ):
            return None
        return AuthorizationCode(
            code=req.code,
            scopes=list(req.scopes or []),
            expires_at=int(req.expires_at.timestamp()),
            client_id=req.client_id,
            code_challenge=req.code_challenge or "",
            redirect_uri=AnyUrl(req.redirect_uri),
            redirect_uri_provided_explicitly=req.redirect_uri_provided_explicitly,
            resource=req.resource,
            subject=str(req.user_id),
        )

    async def exchange_authorization_code(self, client, authorization_code: AuthorizationCode):
        def _consume():
            req = OAuthAuthorizationRequest.objects.filter(
                code=authorization_code.code, used=False
            ).first()
            if req is None:
                return None
            req.used = True
            req.save(update_fields=["used"])
            return req

        req = await sync_to_async(_consume)()
        if req is None:
            from mcp.server.auth.errors import TokenError

            raise TokenError("invalid_grant", "Authorization code is invalid or used")

        email = await sync_to_async(_user_email)(req.user_id)
        return self._issue_tokens(
            req.user_id, email, client.client_id, authorization_code.scopes, authorization_code.resource
        )

    # --- Refresh --------------------------------------------------------
    async def load_refresh_token(self, client, refresh_token):
        try:
            claims = tokens.decode(refresh_token)
        except jwt.PyJWTError:
            return None
        if claims.get("typ") != "refresh" or claims.get("client_id") != client.client_id:
            return None
        if await sync_to_async(_is_revoked)(claims.get("jti", "")):
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=client.client_id,
            scopes=(claims.get("scope") or "").split() or [],
            expires_at=claims.get("exp"),
        )

    async def exchange_refresh_token(self, client, refresh_token: RefreshToken, scopes):
        claims = tokens.decode(refresh_token.token)
        # Rotate: revoke the presented refresh token.
        await sync_to_async(_revoke)(
            claims["jti"], timezone.now() + timedelta(days=int(settings.MCP_REFRESH_TOKEN_TTL_DAYS))
        )
        granted = list(scopes) if scopes else (claims.get("scope") or "").split()
        return self._issue_tokens(int(claims["sub"]), claims.get("email"), client.client_id, granted, None)

    # --- Access token verification (gates the /mcp endpoint) ------------
    async def load_access_token(self, token):
        # Static service key for programmatic clients (Claude Code / Desktop).
        if settings.MCP_API_KEY and hmac.compare_digest(token, settings.MCP_API_KEY):
            return AccessToken(
                token=token, client_id="service-key", scopes=[], expires_at=None, subject="service-key"
            )
        try:
            claims = tokens.decode(token)
        except jwt.PyJWTError:
            return None
        if claims.get("typ") != "access":
            return None
        if await sync_to_async(_is_revoked)(claims.get("jti", "")):
            return None
        return AccessToken(
            token=token,
            client_id=claims.get("client_id", ""),
            scopes=(claims.get("scope") or "").split(),
            expires_at=claims.get("exp"),
            resource=claims.get("aud"),
            subject=claims.get("sub"),
            claims=claims,
        )

    async def revoke_token(self, token):
        try:
            claims = tokens.decode(token.token)
        except jwt.PyJWTError:
            return
        jti = claims.get("jti")
        exp = claims.get("exp", int(time.time()))
        if jti:
            await sync_to_async(_revoke)(
                jti, timezone.datetime.fromtimestamp(exp, tz=timezone.get_current_timezone())
            )

    def _issue_tokens(self, user_id, email, client_id, scopes, resource):
        scopes = list(scopes or [])
        access, _, _ = tokens.mint_access_token(
            user_id=user_id, email=email, client_id=client_id, scopes=scopes, resource=resource
        )
        refresh, _, _ = tokens.mint_refresh_token(
            user_id=user_id, email=email, client_id=client_id, scopes=scopes
        )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",
            expires_in=int(settings.MCP_ACCESS_TOKEN_TTL),
            scope=" ".join(scopes) or None,
            refresh_token=refresh,
        )
