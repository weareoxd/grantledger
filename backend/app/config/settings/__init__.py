"""
Project settings, split by environment with django-configurations.

Each environment (Local, Test, Production) is a class inheriting from Base.
Settings that read the environment use ``Value``; e.g. ``MCP_MAX_ROWS = Value("500",
environ_prefix=None)`` reads ``MCP_MAX_ROWS`` from the environment when set.
"""

from .local import Local
from .production import Production
from .test import Test

__all__ = ("Local", "Test", "Production")
