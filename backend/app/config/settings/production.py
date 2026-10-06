from .base import Base


class Production(Base):
    """Production settings: everything sensitive comes from the environment."""

    @classmethod
    def setup(cls):
        super().setup()
        # Reuse database connections across requests (MCP workers hold few connections).
        cls.DATABASES["default"]["CONN_MAX_AGE"] = 60
        cls.DATABASES["default"]["CONN_HEALTH_CHECKS"] = True
