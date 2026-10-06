"""Run the read-only grants MCP server over stdio (local / developer clients)."""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Run the read-only grants MCP server over stdio."

    def handle(self, *args, **options):
        # Imported here so Django is fully initialised before tools register.
        from app.mcp_server.server import mcp

        mcp.run(transport="stdio")
