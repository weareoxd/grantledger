from .base import Base


class Local(Base):
    """Local development (docker compose)."""

    ALLOWED_HOSTS = ["*"]
