"""
Versioned cache keys.

Every cache key embeds a global data-version token. Bumping the version (after any
grants data change) makes all previously written keys unreachable in O(1); orphaned
entries age out via the cache backend's TTL and culling.
"""

import hashlib
import time

from django.core.cache import cache

VERSION_KEY = "gl:data_version"


def _new_token():
    return format(time.time_ns(), "x")


def get_version():
    """Return the current data-version token, creating one if missing."""
    version = cache.get(VERSION_KEY)
    if version is None:
        # add() is set-if-absent, so racing processes converge on one token.
        cache.add(VERSION_KEY, _new_token(), timeout=None)
        version = cache.get(VERSION_KEY) or _new_token()
    return version


def bump_version():
    """Invalidate every versioned cache entry (last-write-wins, race-free)."""
    cache.set(VERSION_KEY, _new_token(), timeout=None)


def make_key(kind, identity, version=None):
    """Build a versioned cache key; ``identity`` is hashed to bound key length."""
    digest = hashlib.md5(identity.encode(), usedforsecurity=False).hexdigest()
    return f"gl:{version or get_version()}:{kind}:{digest}"
