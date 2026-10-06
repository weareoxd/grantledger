"""URL configuration: only the Django admin. Data access is through the MCP server."""

from django.conf import settings
from django.contrib import admin
from django.urls import path

urlpatterns = [
    path("admin/", admin.site.urls),
]

admin.site.site_header = f"{settings.SITE_NAME} administration"
admin.site.site_title = f"{settings.SITE_NAME} admin"
