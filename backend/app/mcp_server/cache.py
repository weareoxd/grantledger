"""
Version-keyed read-through caching for MCP tool results.

Tool results are pure functions of their arguments and the underlying data, so
they are cached under the global data version (app.core.cache). Any import or
edit bumps the version, making every previously written entry unreachable.
"""

import functools
import inspect
import json

from django.core.cache import cache

from app.core.cache import make_key


def cached_result(fn):
    """Read-through cache for a deterministic read-only tool function.

    Arguments are canonicalised through signature binding, so positional, keyword
    and defaulted invocations of the same call share one entry. Exceptions
    propagate uncached. Results must never be None (None is the miss sentinel).
    """
    signature = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        identity = f"{fn.__module__}.{fn.__qualname__}:" + json.dumps(
            bound.arguments, sort_keys=True, default=str
        )
        key = make_key("mcp", identity)
        result = cache.get(key)
        if result is None:
            result = fn(*bound.args, **bound.kwargs)
            cache.set(key, result)
        return result

    return wrapper
