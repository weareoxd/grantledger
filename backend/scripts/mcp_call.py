"""
Minimal MCP client for smoke tests and the question bank.

    python scripts/mcp_call.py list-tools
    python scripts/mcp_call.py call award_totals '{"group_by": "organization"}'

Connects to MCP_URL (default http://mcp:8082/mcp) with MCP_API_KEY as the bearer token.
"""

import asyncio
import json
import os
import sys
import time

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

URL = os.environ.get("MCP_URL", "http://mcp:8082/mcp")


async def main(argv):
    headers = {"Authorization": f"Bearer {os.environ['MCP_API_KEY']}"}
    async with streamablehttp_client(URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            if argv[0] == "list-tools":
                tools = await session.list_tools()
                print(f"server: {init.serverInfo.name} {init.serverInfo.version}")
                for t in tools.tools:
                    print(f"- {t.name}: {(t.description or '').strip().splitlines()[0]}")
                return
            if argv[0] == "call":
                args = json.loads(argv[2]) if len(argv) > 2 else {}
                started = time.monotonic()
                result = await session.call_tool(argv[1], args)
                elapsed = time.monotonic() - started
                text = "".join(getattr(c, "text", "") for c in result.content)
                status = "ERROR" if result.isError else "ok"
                print(f"[{status}] {argv[1]} in {elapsed:.2f}s", file=sys.stderr)
                try:
                    print(json.dumps(json.loads(text), indent=2, ensure_ascii=False))
                except ValueError:
                    print(text)
                return
            raise SystemExit(__doc__)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["list-tools"]))
