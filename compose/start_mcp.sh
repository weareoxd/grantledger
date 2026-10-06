#!/bin/bash
# Read-only MCP server (Streamable-HTTP) for local development.
set -o errexit
set -o pipefail
set -o nounset

echo 'Waiting for migrations to be applied by the django service'
until python manage.py migrate --check >/dev/null 2>&1; do sleep 2; done

echo '[MCP] Starting uvicorn on :8082'
exec uvicorn app.mcp_server.asgi:application \
  --host 0.0.0.0 \
  --port 8082 \
  --workers "${MCP_WORKERS:-1}" \
  --timeout-keep-alive 75 \
  --log-level info
