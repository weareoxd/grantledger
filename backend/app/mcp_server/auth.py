"""
Static bearer-token auth for the remote (Streamable-HTTP) transport when OAuth is
not configured.

A minimal pure-ASGI middleware, so it does not buffer the streaming response. Every
HTTP request must carry ``Authorization: Bearer <MCP_API_KEY>``; the health check is
exempt. The local stdio transport does not use this: it is trusted.
"""

import hmac
import json

EXEMPT_PATHS = ("/healthz",)


class BearerTokenMiddleware:
    def __init__(self, app, token, exempt_paths=EXEMPT_PATHS):
        self.app = app
        self.token = token or ""
        self.exempt_paths = tuple(exempt_paths)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope.get("path", "") in self.exempt_paths:
            await self.app(scope, receive, send)
            return
        if not self.token:
            await self._reject(send, "MCP server is not configured (no MCP_API_KEY set)")
            return
        if not self._authorized(scope):
            await self._reject(send, "Missing or invalid bearer token")
            return
        await self.app(scope, receive, send)

    def _authorized(self, scope):
        for name, value in scope.get("headers", []):
            if name == b"authorization":
                header = value.decode("latin-1")
                prefix = "Bearer "
                if header.startswith(prefix):
                    presented = header[len(prefix):].strip()
                    return hmac.compare_digest(presented, self.token)
        return False

    async def _reject(self, send, detail):
        body = json.dumps({"error": "unauthorized", "detail": detail}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b"Bearer"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
