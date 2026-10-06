from django.apps import AppConfig


class GrantsConfig(AppConfig):
    name = "app.grants"

    def ready(self):
        from app.grants import signals  # noqa: F401  (registers cache invalidation)
