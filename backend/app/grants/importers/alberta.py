"""
Importer for the Government of Alberta's Grant Payments Disclosure
(open.alberta.ca, one ``tbf-grants-disclosure-<fy>.csv`` per fiscal year).

One row per cash payment. Two header layouts exist: the yearly files
(``Lottery``, ISO dates, ``FiscalYear``) and the live current-year export
(``LotteryFund``, US-style timestamps, a trailing empty column). Rows with a
blank recipient are Alberta's own unnamed aggregates (physician fee-for-service,
income-support benefits, ...); they usually have no payment date, so their
start_date is the first day of the fiscal year and flagged as estimated.
"""

import re

from app.grants.importers.base import (
    ParsedAward,
    clean,
    fiscal_year_start,
    parse_bool,
    parse_date,
    parse_decimal,
    run_import,
)
from app.grants.models import Award
from app.grants.normalize import (
    NOT_DISCLOSED,
    WITHHELD_INDIVIDUAL,
    clean_display,
    looks_like_person,
    normalize_name,
)

_SMALL_WORDS = {"and", "of", "the", "for", "in", "on", "to", "de", "la", "du", "des"}

# Spellings that only occur because of publishing errors, mapped to the ministry's
# real name. Genuine reorganisations (e.g. Children's Services -> Children and Family
# Services) are left alone: Alberta reports payments under the ministry of the day.
_MINISTRY_FIXES = {
    "CULTURE,MULTICULTURALISMANDSTATUSOFWOMEN": "CULTURE, MULTICULTURALISM AND STATUS OF WOMEN",
    "SENIORS AND HOUSING TBI": "SENIORS AND HOUSING",
}


def ministry_title(name):
    """'SENIORS, COMMUNITY AND SOCIAL SERVICES' -> 'Seniors, Community and Social Services'."""
    name = _MINISTRY_FIXES.get(name.upper().strip(), name)
    name = re.sub(r",(?=\S)", ", ", name)  # "A,B" -> "A, B"
    words = name.lower().split()
    return " ".join(
        w if i and w in _SMALL_WORDS else w[:1].upper() + w[1:] for i, w in enumerate(words)
    )[:255]


def _fiscal_year(row):
    year = clean(row.get("FiscalYear"))
    if year and year.isdigit():
        return int(year)
    display = clean(row.get("DisplayFiscalYear")) or ""
    match = re.match(r"\s*(\d{4})", display)
    return int(match.group(1)) if match else None


def make_parser(include_individuals=False):
    def parse(row, line_no, stats):
        ministry = clean(row.get("Ministry"))
        fiscal_year = _fiscal_year(row)
        if not ministry or fiscal_year is None:
            return None

        day = parse_date(row.get("PaymentDate"))
        estimated = day is None
        if estimated:
            day = fiscal_year_start(fiscal_year)

        raw_name = clean(row.get("Recipient"))
        if not raw_name:
            key = display = NOT_DISCLOSED
        elif not include_individuals and looks_like_person(raw_name):
            key = display = WITHHELD_INDIVIDUAL
        else:
            key = normalize_name(raw_name) or NOT_DISCLOSED
            display = clean_display(raw_name)

        lottery_raw = row["Lottery"] if "Lottery" in row else row.get("LotteryFund")
        return ParsedAward(
            ministry=ministry_title(ministry),
            program=(clean(row.get("Program")) or "")[:500] or None,
            recipient_key=key,
            recipient_display=display,
            fields={
                "record_kind": Award.PAYMENT,
                "reference": f"AB-{fiscal_year}-{line_no:07d}",
                "is_current": True,
                "value": parse_decimal(row.get("Amount")),
                "start_date": day,
                "start_date_estimated": estimated,
                "business_unit": (clean(row.get("BUName")) or "")[:255] or None,
                "lottery_fund": parse_bool(lottery_raw),
            },
        )

    return parse


def import_alberta(path, *, include_individuals=False, limit=None, batch_size=5000):
    return run_import(
        path, "alberta", make_parser(include_individuals), limit=limit, batch_size=batch_size
    )
