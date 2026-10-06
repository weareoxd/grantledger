"""
ASGI entrypoint for the remote (Streamable-HTTP) MCP transport.

Run with ``uvicorn app.mcp_server.asgi:application``. The MCP endpoint is served at
``/mcp``; ``/healthz`` answers unauthenticated for load balancers and compose.
"""

import os

import configurations

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "app.config.settings")
os.environ.setdefault("DJANGO_CONFIGURATION", "Production")

configurations.setup()

from django.conf import settings  # noqa: E402
from starlette.responses import JSONResponse  # noqa: E402
from starlette.routing import Route  # noqa: E402

from app.mcp_server.server import mcp, oauth_enabled  # noqa: E402

app = mcp.streamable_http_app()


async def healthz(request):
    return JSONResponse({"status": "ok"})


app.router.routes.append(Route("/healthz", healthz, methods=["GET"]))

if oauth_enabled:
    # OAuth tokens are enforced by the SDK's auth middleware on /mcp; add the Google
    # federation callback route to the same app.
    from app.mcp_server.oauth.routes import google_callback  # noqa: E402

    app.router.routes.append(Route("/mcp-oauth/google/callback", google_callback, methods=["GET"]))
    application = app
else:
    # No OAuth configured: gate the remote transport with the static bearer key.
    from app.mcp_server.auth import BearerTokenMiddleware  # noqa: E402

    application = BearerTokenMiddleware(app, token=settings.MCP_API_KEY)
