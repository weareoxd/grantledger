from .base import Base


class Test(Base):
    """Automated tests: in-memory sqlite and a LocMem cache (so cache behaviour is exercised)."""

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    }
    CACHES = {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    }
