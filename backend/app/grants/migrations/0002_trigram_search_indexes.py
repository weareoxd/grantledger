"""
Trigram indexes for case-insensitive substring search (PostgreSQL only).

Django compiles ``name__icontains`` to ``UPPER("name"::text) LIKE UPPER(%s)``, so the
index must be on that exact expression or the planner ignores it. Skipped on other
databases (the sqlite test runner).
"""

from django.db import migrations

INDEXES = [
    ("grants_recipient_name_trgm", "grants_recipient", "name"),
    ("grants_recipient_display_trgm", "grants_recipient", "display_name"),
    ("grants_program_name_trgm", "grants_program", "name"),
    ("grants_ministry_name_trgm", "grants_ministry", "name"),
]


def forwards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for name, table, column in INDEXES:
        schema_editor.execute(
            f'CREATE INDEX IF NOT EXISTS {name} ON {table} USING gin ((UPPER("{column}"::text)) gin_trgm_ops)'
        )


def backwards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    for name, _table, _column in INDEXES:
        schema_editor.execute(f"DROP INDEX IF EXISTS {name}")


class Migration(migrations.Migration):
    dependencies = [("grants", "0001_initial")]

    operations = [migrations.RunPython(forwards, backwards)]
