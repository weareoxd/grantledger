"""Base application settings. ``Value`` settings are exposed via env vars."""

from pathlib import Path

from configurations import Configuration
from configurations.values import BooleanValue, IntegerValue, ListValue, Value


class Base(Configuration):
    SITE_NAME = Value("GrantLedger", environ_prefix=None)

    BASE_DIR = Path(__file__).resolve().parent.parent.parent

    SECRET_KEY = Value("django-insecure-change-me", environ_prefix=None)
    DEBUG = BooleanValue(False, environ_name="DEBUG", environ_prefix=None)

    ALLOWED_HOSTS = ListValue(["localhost", "127.0.0.1"], separator=" ", environ_prefix=None)
    CSRF_TRUSTED_ORIGINS = ListValue(["http://localhost"], separator=" ", environ_prefix=None)

    DJANGO_APPS = [
        "django.contrib.admin",
        "django.contrib.auth",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "django.contrib.messages",
        "django.contrib.staticfiles",
    ]
    LOCAL_APPS = [
        "app.core.apps.CoreConfig",
        "app.account.apps.AccountConfig",
        "app.grants.apps.GrantsConfig",
        "app.mcp_server.apps.MCPServerConfig",
    ]

    @property
    def INSTALLED_APPS(self):
        return self.DJANGO_APPS + self.LOCAL_APPS

    MIDDLEWARE = [
        "django.middleware.security.SecurityMiddleware",
        "django.contrib.sessions.middleware.SessionMiddleware",
        "django.middleware.common.CommonMiddleware",
        "django.middleware.csrf.CsrfViewMiddleware",
        "django.contrib.auth.middleware.AuthenticationMiddleware",
        "django.contrib.messages.middleware.MessageMiddleware",
        "django.middleware.clickjacking.XFrameOptionsMiddleware",
    ]

    ROOT_URLCONF = "app.config.urls"
    WSGI_APPLICATION = "app.config.wsgi.application"

    TEMPLATES = [
        {
            "BACKEND": "django.template.backends.django.DjangoTemplates",
            "DIRS": [],
            "APP_DIRS": True,
            "OPTIONS": {
                "context_processors": [
                    "django.template.context_processors.debug",
                    "django.template.context_processors.request",
                    "django.contrib.auth.context_processors.auth",
                    "django.contrib.messages.context_processors.messages",
                ],
            },
        },
    ]

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": Value("grantledger", environ_name="DB_DATABASE", environ_prefix=None),
            "USER": Value("grantledger", environ_name="DB_USER", environ_prefix=None),
            "PASSWORD": Value("grantledger", environ_name="DB_PASSWORD", environ_prefix=None),
            "HOST": Value("postgres", environ_name="DB_HOST", environ_prefix=None),
            "PORT": IntegerValue(5432, environ_name="DB_PORT", environ_prefix=None),
        }
    }

    # Cross-process cache shared by the MCP workers and the importers. Entries are
    # invalidated by bumping the data version (app.core.cache); TIMEOUT is a backstop.
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "cache",
            "TIMEOUT": 60 * 60 * 24,
            "OPTIONS": {"MAX_ENTRIES": 10000, "CULL_FREQUENCY": 4},
        }
    }

    AUTH_PASSWORD_VALIDATORS = [
        {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    ]
    AUTH_USER_MODEL = "account.User"

    LANGUAGE_CODE = "en-ca"
    TIME_ZONE = "America/Edmonton"
    USE_I18N = True
    USE_TZ = True

    STATIC_URL = "static/"
    STATIC_ROOT = BASE_DIR / "staticfiles"
    DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
        "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
        "root": {"handlers": ["console"], "level": Value("WARNING", environ_name="LOG_LEVEL")},
        "loggers": {
            "grants_import": {"handlers": ["console"], "level": "INFO", "propagate": False},
            # One JSON line per MCP tool call: tool, arguments, caller, duration, rows.
            "mcp_audit": {
                "handlers": ["console"],
                "level": Value("INFO", environ_name="MCP_AUDIT_LOG_LEVEL"),
                "propagate": False,
            },
        },
    }

    # Google OAuth client used by the MCP server's federated login. No defaults on
    # purpose: configure through the environment.
    GOOGLE_OAUTH2_CLIENT_ID = Value("", environ_prefix=None)
    GOOGLE_OAUTH2_CLIENT_SECRET = Value("", environ_prefix=None)
    GOOGLE_OAUTH2_PROJECT_ID = Value("", environ_prefix=None)

    # MCP server (read-only LLM access)
    # Static bearer token accepted by the remote (Streamable-HTTP) transport, used by
    # programmatic clients (Claude Code / Desktop). Still honoured when OAuth is on.
    # The local stdio transport is trusted and does not check this.
    MCP_API_KEY = Value("", environ_prefix=None)
    # Hard cap on the number of rows any single MCP tool call may return.
    # Set blank (MCP_MAX_ROWS=) or "none"/"null"/0 for unlimited.
    MCP_MAX_ROWS = Value("500", environ_prefix=None)
    # MCP OAuth (Google federation). Set MCP_PUBLIC_URL to this server's public https
    # origin (the OAuth issuer). Blank disables OAuth (static bearer only).
    MCP_PUBLIC_URL = Value("", environ_prefix=None)
    # Optional app-side allowlist of Google email domains (space-separated), enforced
    # as defence-in-depth on top of the Google OAuth app's own restriction.
    MCP_ALLOWED_EMAIL_DOMAINS = ListValue([], separator=" ", environ_prefix=None)
    MCP_ACCESS_TOKEN_TTL = IntegerValue(3600, environ_prefix=None)  # seconds
    MCP_REFRESH_TOKEN_TTL_DAYS = IntegerValue(30, environ_prefix=None)
