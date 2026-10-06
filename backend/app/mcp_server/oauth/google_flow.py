"""
Google OAuth federation for the MCP authorization server.

The MCP server is the OAuth *client* of Google here: the human signs in with Google,
and on success the server issues its own tokens to the MCP client (claude.ai,
ChatGPT, ...). Uses its own redirect URI and PKCE verifier.
"""

import google_auth_oauthlib.flow
import jwt as pyjwt
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "openid",
]


def google_redirect_uri():
    return f"{settings.MCP_PUBLIC_URL}/mcp-oauth/google/callback"


def _client_config():
    client_id = settings.GOOGLE_OAUTH2_CLIENT_ID
    client_secret = settings.GOOGLE_OAUTH2_CLIENT_SECRET
    if not client_id or not client_secret:
        raise ImproperlyConfigured(
            "GOOGLE_OAUTH2_CLIENT_ID and GOOGLE_OAUTH2_CLIENT_SECRET are required when MCP_PUBLIC_URL is set."
        )
    return {
        "web": {
            "client_id": client_id,
            "project_id": settings.GOOGLE_OAUTH2_PROJECT_ID,
            "auth_uri": GOOGLE_AUTH_URL,
            "token_uri": GOOGLE_TOKEN_URL,
            "client_secret": client_secret,
            "redirect_uris": [google_redirect_uri()],
        }
    }


def build_authorization_url(code_verifier):
    """Return (authorization_url, google_state) for the given PKCE verifier."""
    flow = google_auth_oauthlib.flow.Flow.from_client_config(
        client_config=_client_config(), scopes=SCOPES, code_verifier=code_verifier
    )
    flow.redirect_uri = google_redirect_uri()
    authorization_url, state = flow.authorization_url(
        access_type="offline", include_granted_scopes="true", prompt="select_account"
    )
    return authorization_url, state


def exchange_code(*, code, state, code_verifier):
    """Exchange a Google authorization code and return the id_token claims."""
    flow = google_auth_oauthlib.flow.Flow.from_client_config(
        client_config=_client_config(), scopes=SCOPES, state=state, code_verifier=code_verifier
    )
    flow.redirect_uri = google_redirect_uri()
    payload = flow.fetch_token(code=code)
    # The id_token came straight from Google's token endpoint over TLS in exchange
    # for our code + PKCE verifier, so its claims are trusted without re-verifying.
    return pyjwt.decode(payload["id_token"], options={"verify_signature": False})


def email_domain_allowed(claims):
    """
    Whether a Google identity may sign in.

    The email must be verified. MCP_ALLOWED_EMAIL_DOMAINS is an optional app-side
    allowlist enforced as defence-in-depth; blank trusts the Google OAuth app's own
    restriction (e.g. an Internal / Workspace-scoped app).
    """
    if not claims.get("email_verified"):
        return False
    allowed = {d.lower().lstrip("@") for d in settings.MCP_ALLOWED_EMAIL_DOMAINS}
    if not allowed:
        return True
    email = (claims.get("email") or "").lower()
    domain = email.rpartition("@")[2]
    return bool(domain) and domain in allowed
