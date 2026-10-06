"""
Google federation callback for the MCP OAuth server.

Google redirects the browser here after login. We exchange the Google code,
enforce the email-domain policy, provision the user, mint a one-time authorization
code, and send the browser back to the MCP client's redirect_uri.
"""

import secrets
from urllib.parse import urlencode

from asgiref.sync import sync_to_async
from django.utils import timezone
from starlette.responses import HTMLResponse, RedirectResponse

from app.account.models import User
from app.mcp_server.models import OAuthAuthorizationRequest
from app.mcp_server.oauth import google_flow


def _complete_request(google_state, claims):
    """Bind the authenticated user to the request and issue an auth code (sync)."""
    req = OAuthAuthorizationRequest.objects.filter(google_state=google_state, used=False).first()
    if req is None or req.expires_at < timezone.now():
        return None, None
    user, _created = User.objects.update_or_create_from_access_token(**claims)
    req.user_id = user.id
    req.code = secrets.token_urlsafe(32)
    req.save(update_fields=["user_id", "code"])
    return req, user


def _build_redirect(redirect_uri, params):
    sep = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{sep}{urlencode(params)}"


async def _load_request(google_state):
    return await sync_to_async(
        lambda: OAuthAuthorizationRequest.objects.filter(google_state=google_state).first()
    )()


def _error_redirect(redirect_uri, state, error, description):
    params = {"error": error, "error_description": description}
    if state:
        params["state"] = state
    return RedirectResponse(_build_redirect(redirect_uri, params))


async def google_callback(request):
    state = request.query_params.get("state")
    code = request.query_params.get("code")
    error = request.query_params.get("error")

    if not state:
        return HTMLResponse("Missing state parameter.", status_code=400)

    req = await _load_request(state)
    if req is None or req.used or req.expires_at < timezone.now():
        return HTMLResponse("Login request expired or invalid. Please try again.", status_code=400)

    if error:
        return _error_redirect(req.redirect_uri, req.mcp_state, "access_denied", error)
    if not code:
        return _error_redirect(req.redirect_uri, req.mcp_state, "invalid_request", "Missing code")

    try:
        claims = await sync_to_async(google_flow.exchange_code)(
            code=code, state=state, code_verifier=req.google_code_verifier
        )
    except Exception:
        return _error_redirect(req.redirect_uri, req.mcp_state, "server_error", "Google token exchange failed")

    if not google_flow.email_domain_allowed(claims):
        return _error_redirect(
            req.redirect_uri, req.mcp_state, "access_denied",
            "Your Google account is not permitted to access this connector.",
        )

    completed, _user = await sync_to_async(_complete_request)(state, claims)
    if completed is None:
        return HTMLResponse("Login request expired. Please try again.", status_code=400)

    params = {"code": completed.code}
    if completed.mcp_state:
        params["state"] = completed.mcp_state
    return RedirectResponse(_build_redirect(completed.redirect_uri, params))
