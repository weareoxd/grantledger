"""
Shared machinery for the two importers: tolerant CSV reading, batched lookups for
ministries / programs / recipients, and the post-import bookkeeping (amendment
flags, fiscal years, cache invalidation).
"""

import csv
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from django.db.models import OuterRef, Subquery

from app.core.cache import bump_version
from app.grants.constants import ORGANIZATIONS
from app.grants.models import Award, FiscalYear, Ministry, Organization, Program, Recipient
from app.grants.normalize import NOT_DISCLOSED, PLACEHOLDER_NAMES, WITHHELD_INDIVIDUAL

logger = logging.getLogger("grants_import")

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------
def iter_decoded_lines(path):
    """Yield text lines, decoding each as UTF-8 and falling back to Windows-1252.

    Alberta's files switched encoding between years (2023-24 and 2024-25 are
    Windows-1252), and decoding per line keeps one bad byte from failing a file.
    """
    with open(path, "rb") as fh:
        first = True
        for raw in fh:
            try:
                line = raw.decode("utf-8")
            except UnicodeDecodeError:
                line = raw.decode("cp1252", errors="replace")
            if first:
                line = line.lstrip("﻿")
                first = False
            yield line


MALFORMED = "__malformed__"


def read_rows(path):
    """
    DictReader over a source file; a blank trailing header column is dropped.

    Rows whose field count does not match the header (an unquoted comma inside a
    name shifts every later column) are flagged with MALFORMED instead of being
    parsed: a shifted row would put a program name in the amount column.
    """
    reader = csv.DictReader(iter_decoded_lines(path))
    for row in reader:
        extra = row.pop(None, None)
        row.pop("", None)
        if any(v for v in (extra or [])) or any(v is None for v in row.values()):
            row[MALFORMED] = True
        yield row


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def clean(value):
    """Trim whitespace and stray wrapping quotes; '' becomes None."""
    value = (value or "").strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = value[1:-1].strip()
    return value or None


def parse_decimal(value):
    value = clean(value)
    if value is None:
        return None
    try:
        return Decimal(value.replace(",", "").replace("$", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None


_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S")


def parse_date(value):
    value = clean(value)
    if value is None:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def parse_bool(value):
    value = (value or "").strip().lower()
    if value in ("true", "t", "yes", "y", "1"):
        return True
    if value in ("false", "f", "no", "n", "0"):
        return False
    return None


def fiscal_year_start(year):
    return date(int(year), 4, 1)


def fiscal_year_of(day):
    return day.year - 1 if day.month < 4 else day.year


# ---------------------------------------------------------------------------
# Batched lookups
# ---------------------------------------------------------------------------
@dataclass
class ParsedAward:
    """One source row, resolved to names; ids are filled in per batch."""

    ministry: str
    program: str | None
    recipient_key: str
    recipient_display: str
    fields: dict = field(default_factory=dict)


class Lookups:
    """Name -> id caches that create missing ministries / programs / recipients per batch."""

    def __init__(self, organization):
        self.organization = organization
        self.ministries = dict(
            Ministry.objects.filter(organization=organization).values_list("name", "id")
        )
        self.programs = {
            (m, n): i
            for i, m, n in Program.objects.filter(
                ministry__organization=organization
            ).values_list("id", "ministry_id", "name")
        }
        self.recipients = dict(Recipient.objects.values_list("name", "id"))

    def resolve(self, batch):
        self._ensure_ministries({p.ministry for p in batch})
        self._ensure_programs({(self.ministries[p.ministry], p.program) for p in batch if p.program})
        self._ensure_recipients({p.recipient_key: p.recipient_display for p in batch})

    def _ensure_ministries(self, names):
        missing = [n for n in names if n not in self.ministries]
        if missing:
            Ministry.objects.bulk_create(
                [Ministry(organization=self.organization, name=n) for n in missing],
                ignore_conflicts=True,
            )
            self.ministries.update(
                Ministry.objects.filter(organization=self.organization, name__in=missing)
                .values_list("name", "id")
            )

    def _ensure_programs(self, keys):
        missing = [k for k in keys if k not in self.programs]
        if missing:
            Program.objects.bulk_create(
                [Program(ministry_id=m, name=n) for m, n in missing], ignore_conflicts=True
            )
            for m in {m for m, _ in missing}:
                names = [n for mm, n in missing if mm == m]
                self.programs.update(
                    ((m, n), i)
                    for i, n in Program.objects.filter(ministry_id=m, name__in=names)
                    .values_list("id", "name")
                )

    def _ensure_recipients(self, display_by_key):
        missing = [k for k in display_by_key if k not in self.recipients]
        if missing:
            Recipient.objects.bulk_create(
                [
                    Recipient(
                        name=k,
                        display_name=display_by_key[k] or k,
                        is_placeholder=k in PLACEHOLDER_NAMES,
                    )
                    for k in missing
                ],
                ignore_conflicts=True,
            )
            for start in range(0, len(missing), 1000):
                chunk = missing[start : start + 1000]
                self.recipients.update(
                    Recipient.objects.filter(name__in=chunk).values_list("name", "id")
                )

    def build(self, parsed, source_file, import_date):
        ministry_id = self.ministries[parsed.ministry]
        return Award(
            ministry_id=ministry_id,
            program_id=self.programs.get((ministry_id, parsed.program)) if parsed.program else None,
            recipient_id=self.recipients[parsed.recipient_key],
            source_file=source_file,
            import_date=import_date,
            **parsed.fields,
        )


# ---------------------------------------------------------------------------
# Import driver
# ---------------------------------------------------------------------------
@dataclass
class ImportStats:
    read: int = 0
    imported: int = 0
    skipped: int = 0
    withheld_individuals: int = 0
    not_disclosed: int = 0
    estimated_dates: int = 0
    malformed: int = 0
    replaced: int = 0

    def __str__(self):
        return ", ".join(f"{k}={v}" for k, v in self.__dict__.items())


def get_organization(key):
    meta = ORGANIZATIONS[key]
    org, _ = Organization.objects.get_or_create(key=key, defaults={"name": meta["name"]})
    return org


def run_import(path, org_key, parse_row, *, limit=None, batch_size=5000):
    """
    Import one file: ``parse_row(row, line_no, stats)`` returns a ParsedAward or None.

    The file name is the unit of replacement: rows previously imported from a file
    with the same name are deleted first, inside the same transaction.
    """
    source_file = os.path.basename(path)
    stats = ImportStats()
    today = date.today()
    with transaction.atomic():
        organization = get_organization(org_key)
        stats.replaced, _ = Award.objects.filter(
            ministry__organization=organization, source_file=source_file
        ).delete()
        lookups = Lookups(organization)
        batch = []

        def flush():
            if not batch:
                return
            lookups.resolve(batch)
            Award.objects.bulk_create(
                [lookups.build(p, source_file, today) for p in batch], batch_size=batch_size
            )
            stats.imported += len(batch)
            batch.clear()
            if stats.imported % (batch_size * 20) == 0:
                logger.info("%s: %s rows imported", source_file, stats.imported)

        for line_no, row in enumerate(read_rows(path), start=1):
            if limit is not None and stats.read >= limit:
                break
            stats.read += 1
            if row.get(MALFORMED):
                stats.malformed += 1
                continue
            parsed = parse_row(row, line_no, stats)
            if parsed is None:
                stats.skipped += 1
                continue
            if parsed.recipient_key == WITHHELD_INDIVIDUAL:
                stats.withheld_individuals += 1
            elif parsed.recipient_key == NOT_DISCLOSED:
                stats.not_disclosed += 1
            if parsed.fields.get("start_date_estimated"):
                stats.estimated_dates += 1
            batch.append(parsed)
            if len(batch) >= batch_size:
                flush()
        flush()
        if org_key == "federal":
            refresh_current_flags(organization)
    ensure_fiscal_years()
    bump_version()
    logger.info("%s: %s", source_file, stats)
    return stats


def refresh_current_flags(organization):
    """Mark the latest amendment of each agreement as current, all others not."""
    agreements = Award.objects.filter(
        ministry__organization=organization, record_kind=Award.AGREEMENT
    )
    if connection.vendor == "postgresql":
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE grants_award a
                   SET is_current = (a.id = latest.id)
                  FROM (
                        SELECT DISTINCT ON (aw.ministry_id, aw.reference)
                               aw.id, aw.ministry_id, aw.reference
                          FROM grants_award aw
                          JOIN grants_ministry m ON m.id = aw.ministry_id
                         WHERE m.organization_id = %s AND aw.record_kind = %s
                         ORDER BY aw.ministry_id, aw.reference, aw.amendment_number DESC,
                                  aw.amendment_date DESC NULLS LAST, aw.id DESC
                       ) latest
                 WHERE a.ministry_id = latest.ministry_id
                   AND a.reference = latest.reference
                   AND a.record_kind = %s
                """,
                [organization.id, Award.AGREEMENT, Award.AGREEMENT],
            )
        return
    latest = (
        Award.objects.filter(
            record_kind=Award.AGREEMENT,
            ministry_id=OuterRef("ministry_id"),
            reference=OuterRef("reference"),
        )
        .order_by("-amendment_number", "-id")
        .values("id")[:1]
    )
    current_ids = set(
        agreements.annotate(latest_id=Subquery(latest))
        .values_list("latest_id", flat=True)
    )
    agreements.exclude(id__in=current_ids).update(is_current=False)
    agreements.filter(id__in=current_ids).update(is_current=True)


def prune_orphans():
    """
    Delete recipients, programs and ministries no award points to; returns the counts.

    Re-imports change which names are kept, so earlier spellings can be left with no
    awards. Pruning keeps them out of search results, which matters for privacy: an
    orphan may be a name (or a fragment of one, from a misaligned row) that a later,
    stricter rule now withholds. Raw SQL on purpose: the ORM would fire a
    cache-bumping signal per deleted row.
    """
    no_award = "NOT EXISTS (SELECT 1 FROM grants_award a WHERE a.{col} = t.id)"
    counts = {}
    with transaction.atomic(), connection.cursor() as cur:
        cur.execute(
            "DELETE FROM grants_recipientalias WHERE recipient_id IN "
            f"(SELECT t.id FROM grants_recipient t WHERE {no_award.format(col='recipient_id')})"
        )
        cur.execute(f"DELETE FROM grants_recipient WHERE id IN (SELECT t.id FROM grants_recipient t WHERE {no_award.format(col='recipient_id')})")
        counts["recipients"] = cur.rowcount
        cur.execute(f"DELETE FROM grants_program WHERE id IN (SELECT t.id FROM grants_program t WHERE {no_award.format(col='program_id')})")
        counts["programs"] = cur.rowcount
        cur.execute(
            "DELETE FROM grants_ministry WHERE id IN (SELECT t.id FROM grants_ministry t WHERE "
            f"{no_award.format(col='ministry_id')} AND NOT EXISTS "
            "(SELECT 1 FROM grants_program p WHERE p.ministry_id = t.id))"
        )
        counts["ministries"] = cur.rowcount
    if any(counts.values()):
        bump_version()
    return counts


def ensure_fiscal_years():
    from django.db.models import Max, Min

    bounds = Award.objects.aggregate(lo=Min("start_date"), hi=Max("start_date"))
    if not bounds["lo"]:
        return
    for year in range(fiscal_year_of(bounds["lo"]), fiscal_year_of(bounds["hi"]) + 1):
        FiscalYear.objects.get_or_create(
            year=year,
            defaults={"start_date": date(year, 4, 1), "end_date": date(year + 1, 3, 31)},
        )
