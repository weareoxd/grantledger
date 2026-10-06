from django.contrib import admin
from django.db import transaction

from app.core.cache import bump_version

from .models import Award, FiscalYear, Ministry, Organization, Program, Recipient, RecipientAlias


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "key"]


@admin.register(Ministry)
class MinistryAdmin(admin.ModelAdmin):
    list_display = ["name", "organization"]
    list_filter = ["organization"]
    search_fields = ["name"]


@admin.register(Program)
class ProgramAdmin(admin.ModelAdmin):
    list_display = ["name", "ministry"]
    search_fields = ["name"]
    raw_id_fields = ["ministry"]


@admin.register(Recipient)
class RecipientAdmin(admin.ModelAdmin):
    list_display = ["name", "display_name"]
    search_fields = ["name", "display_name"]


@admin.register(RecipientAlias)
class RecipientAliasAdmin(admin.ModelAdmin):
    list_display = ["name", "recipient"]
    search_fields = ["name"]
    raw_id_fields = ["recipient"]


@admin.register(Award)
class AwardAdmin(admin.ModelAdmin):
    list_display = [
        "reference", "record_kind", "ministry", "recipient", "value", "start_date",
        "amendment_number", "is_current",
    ]
    list_filter = ["record_kind", "is_current", "agreement_type", "recipient_type", "ministry__organization"]
    search_fields = ["reference", "recipient__name", "title"]
    raw_id_fields = ["ministry", "program", "recipient"]
    date_hierarchy = "start_date"

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        transaction.on_commit(bump_version)

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        transaction.on_commit(bump_version)

    def delete_queryset(self, request, queryset):
        super().delete_queryset(request, queryset)
        transaction.on_commit(bump_version)


@admin.register(FiscalYear)
class FiscalYearAdmin(admin.ModelAdmin):
    list_display = ["year", "start_date", "end_date"]
