"""
Invalidate the versioned cache when reference data changes through the ORM.

Deliberately not connected for ``Award``: a receiver on Award would disable
Django's fast bulk delete, which the importers rely on when replacing a file's
rows. The importers call ``bump_version`` when they finish, and the admin does
the same when an award is edited (see admin.AwardAdmin).
"""

from django.db import transaction
from django.db.models.signals import post_delete, post_save

from app.core.cache import bump_version
from app.grants.models import Ministry, Organization, Program, Recipient


def _bump_on_change(sender, **kwargs):
    transaction.on_commit(bump_version)


for _model in (Organization, Ministry, Program, Recipient):
    post_save.connect(_bump_on_change, sender=_model, dispatch_uid=f"bump_save_{_model.__name__}")
    post_delete.connect(_bump_on_change, sender=_model, dispatch_uid=f"bump_delete_{_model.__name__}")
