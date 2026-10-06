"""
Shared FastMCP server for read-only access to the grants database.

A single ``mcp`` instance is defined here and shared by both transports
(``asgi.py`` for remote Streamable-HTTP, the ``mcp_stdio`` management command for
local stdio). Tool modules are imported at the bottom for their registration
side effects.

Django ORM calls raise ``SynchronousOnlyOperation`` inside MCP's async runtime,
so every tool is a plain sync function wrapped by ``tool`` / ``db_tool`` to run in
a thread via ``sync_to_async``. The wrapper also writes one structured audit log
line per call (who, which tool, which arguments, how long, how many rows), which
is enough to replay any answer.
"""

import functools
import inspect
import json
import logging
import time

from asgiref.sync import sync_to_async
from django.conf import settings
from mcp.server.fastmcp import FastMCP

audit_log = logging.getLogger("mcp_audit")

INSTRUCTIONS = """\
Read-only access to Canadian public grant disclosures: Government of Canada grants and
contributions (agreements) and Government of Alberta grant payments. Organizations,
ministries, programs, recipients, awards and fiscal years. User accounts are not available.

Start with `describe_schema` (or the `schema://grants` resource): its `conventions` section
explains how to read the numbers. Use the curated tools (`list_*`, `get_*`, `award_totals`,
`recipient_funding`, `ministry_funding`, `shared_recipients`) for common questions and the
`query` tool for ad-hoc filtering, grouping and aggregation.

Key rules: fiscal years run April-March (FY2024 = Apr 1 2024 - Mar 31 2025). Federal rows
are agreements (committed totals), Alberta rows are cash payments; report them separately.
Award tools count only the current amendment of each federal agreement unless
current_only=false. Placeholder recipients (individuals with names withheld, recipients not
disclosed) count in totals but are not real recipients. Values are CAD. Cite the Open
Government Licence attribution for each government whose data you use.
"""

# OAuth (Google federation) is enabled when a public issuer URL is configured.
# Otherwise the remote transport falls back to static-bearer-only auth (auth.py).
oauth_enabled = bool(settings.MCP_PUBLIC_URL)

_fastmcp_kwargs = dict(
    instructions=INSTRUCTIONS,
    stateless_http=True,
    json_response=True,
)

if oauth_enabled:
    from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions

    from app.mcp_server.oauth.provider import GrantLedgerOAuthProvider

    _fastmcp_kwargs.update(
        auth_server_provider=GrantLedgerOAuthProvider(),
        auth=AuthSettings(
            issuer_url=settings.MCP_PUBLIC_URL,
            resource_server_url=f"{settings.MCP_PUBLIC_URL}/mcp",
            client_registration_options=ClientRegistrationOptions(enabled=True),
            required_scopes=[],
        ),
    )

mcp = FastMCP("grantledger", **_fastmcp_kwargs)

# The remote transport runs behind a proxy with a public Host header, so the SDK's
# localhost-only DNS-rebinding host check would reject proxied requests. Access is
# gated by OAuth tokens (or the static bearer key) instead.
mcp.settings.transport_security.enable_dns_rebinding_protection = False


def _caller():
    """Identity of the authenticated caller, when the transport carries one."""
    try:
        from mcp.server.auth.middleware.auth_context import get_access_token

        token = get_access_token()
    except Exception:  # pragma: no cover - auth context unavailable on this transport
        token = None
    if token is None:
        return None
    return {"subject": getattr(token, "subject", None), "client_id": token.client_id}


def _row_count(result):
    data = result.get("data") if isinstance(result, dict) else None
    return len(data) if isinstance(data, list) else None


def db_tool(fn):
    """Wrap a sync ORM function so it runs safely in MCP's async loop, with an audit line."""

    @functools.wraps(fn)
    async def wrapper(**kwargs):
        started = time.monotonic()
        entry = {"tool": fn.__name__, "args": kwargs, "caller": _caller()}
        try:
            result = await sync_to_async(fn, thread_sensitive=True)(**kwargs)
        except Exception as exc:
            entry.update(ms=round((time.monotonic() - started) * 1000), error=str(exc)[:500])
            audit_log.info(json.dumps(entry, default=str))
            raise
        entry.update(ms=round((time.monotonic() - started) * 1000), rows=_row_count(result))
        audit_log.info(json.dumps(entry, default=str))
        return result

    # Preserve the original signature/annotations so FastMCP builds the correct
    # input schema instead of seeing (**kwargs).
    wrapper.__signature__ = inspect.signature(fn)
    wrapper.__annotations__ = dict(getattr(fn, "__annotations__", {}))
    return wrapper


def tool(fn):
    """
    Register a sync ORM function as an MCP tool.

    The async wrapper is what runs in production. The original sync function is
    returned as the module attribute so tests can call it directly.
    """
    mcp.tool()(db_tool(fn))
    return fn


# Import tool modules for their @tool registration side effects (after `mcp`/`tool`
# exist, to avoid a circular import).
from app.mcp_server import schema  # noqa: E402
from app.mcp_server.tools import aggregates, flexible, records  # noqa: E402,F401


@mcp.resource("schema://grants")
def schema_resource() -> str:
    """Machine-readable description of the models, fields, conventions and operators."""
    return json.dumps(schema.describe_schema(), indent=2)
