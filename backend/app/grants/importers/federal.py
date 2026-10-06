"""
Importer for the Government of Canada's Proactive Disclosure of Grants and
Contributions (open.canada.ca, ``grants.csv``).

One row per agreement *amendment*: ``ref_number`` + ``amendment_number`` identify
it, and each amendment restates the full agreement value. Every amendment is
kept for history; ``is_current`` marks the latest one so totals don't double count.
"""

from app.grants.constants import AGREEMENT_TYPES, RECIPIENT_TYPES
from app.grants.importers.base import ParsedAward, clean, parse_date, parse_decimal, run_import
from app.grants.models import Award
from app.grants.normalize import (
    NOT_DISCLOSED,
    WITHHELD_INDIVIDUAL,
    clean_display,
    looks_like_person,
    normalize_name,
)


def department_name(owner_org_title):
    """'Accessibility Standards Canada | Normes d’accessibilité Canada' -> English half."""
    title = clean(owner_org_title) or "Unknown department"
    return title.split(" | ")[0].strip()[:255]


def _int(value, default=0):
    try:
        return int(float(clean(value) or default))
    except (TypeError, ValueError):
        return default


# Recipient types that are never individuals. Every other type (including blank
# legacy rows) is checked by name: personal names are disclosed under for-profit
# (farm couples), not-for-profit, Indigenous and "other" types as well.
INSTITUTIONAL_TYPES = {"G", "S"}


def is_individual(recipient_type, name):
    """Type P is an individual; government and academia never are; others go by name."""
    if recipient_type == "P":
        return True
    if recipient_type in INSTITUTIONAL_TYPES:
        return False
    return bool(name) and looks_like_person(name)


def make_parser(include_individuals=False):
    def parse(row, line_no, stats):
        reference = clean(row.get("ref_number"))
        start = parse_date(row.get("agreement_start_date"))
        if not reference or start is None:
            return None

        rtype = (clean(row.get("recipient_type")) or "").upper()[:1] or None
        if rtype not in RECIPIENT_TYPES:
            rtype = None
        atype = (clean(row.get("agreement_type")) or "").upper()[:1] or None
        if atype not in AGREEMENT_TYPES:
            atype = None
        raw_name = clean(row.get("recipient_legal_name")) or clean(row.get("recipient_operating_name"))

        fields = {
            "record_kind": Award.AGREEMENT,
            "reference": reference[:255],
            "amendment_number": _int(row.get("amendment_number")),
            "amendment_date": parse_date(row.get("amendment_date")),
            "agreement_type": atype,
            "recipient_type": rtype,
            "recipient_province": (clean(row.get("recipient_province")) or "")[:64] or None,
            "recipient_city": (clean(row.get("recipient_city")) or "")[:255] or None,
            "value": parse_decimal(row.get("agreement_value")),
            "start_date": start,
            "end_date": parse_date(row.get("agreement_end_date")),
            "title": (clean(row.get("agreement_title_en")) or "")[:1000] or None,
            "description": clean(row.get("description_en")),
            "naics": (clean(row.get("naics_identifier")) or "")[:16] or None,
        }

        if not include_individuals and is_individual(rtype, raw_name):
            key = display = WITHHELD_INDIVIDUAL
            # Titles, descriptions and cities can identify a person; drop them too.
            fields.update(recipient_city=None, title=None, description=None)
        elif not raw_name:
            key = display = NOT_DISCLOSED
        else:
            key = normalize_name(raw_name) or NOT_DISCLOSED
            display = clean_display(raw_name)

        return ParsedAward(
            ministry=department_name(row.get("owner_org_title")),
            program=(clean(row.get("prog_name_en")) or "")[:500] or None,
            recipient_key=key,
            recipient_display=display,
            fields=fields,
        )

    return parse


def import_federal(path, *, include_individuals=False, limit=None, batch_size=5000):
    return run_import(
        path, "federal", make_parser(include_individuals), limit=limit, batch_size=batch_size
    )
