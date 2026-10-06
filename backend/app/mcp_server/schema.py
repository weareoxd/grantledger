"""
Allowlist and schema description for the read-only MCP server.

This module is the single security boundary that decides which models and fields
an LLM may read. It references ONLY the grants models, never ``account.User`` or
the OAuth tables. Adding a model or field here is the only way to make it
reachable from any MCP tool: the flexible ``query`` tool, every filter, sort and
aggregation validates against the maps below.
"""

from app.grants.constants import AGREEMENT_TYPES, ORGANIZATIONS, RECIPIENT_TYPES, RECORD_KINDS
from app.grants.models import Award, FiscalYear, Ministry, Organization, Program, Recipient
from app.grants.normalize import NOT_DISCLOSED, WITHHELD_INDIVIDUAL

# ---------------------------------------------------------------------------
# Model allowlist
# ---------------------------------------------------------------------------
ALLOWED_MODELS = {
    "organization": Organization,
    "ministry": Ministry,
    "program": Program,
    "recipient": Recipient,
    "award": Award,
    "fiscal_year": FiscalYear,
}

# ---------------------------------------------------------------------------
# Field maps: LLM-facing name -> (ORM path, type). Paths only ever traverse toward
# the allowed models. Types: int, str, decimal, date, bool, fiscal_year.
# ---------------------------------------------------------------------------
ORGANIZATION_FIELDS = {
    "id": ("id", "int"),
    "name": ("name", "str"),
}

MINISTRY_FIELDS = {
    "id": ("id", "int"),
    "name": ("name", "str"),
    "organization_id": ("organization_id", "int"),
    "organization": ("organization__name", "str"),
}

PROGRAM_FIELDS = {
    "id": ("id", "int"),
    "name": ("name", "str"),
    "ministry_id": ("ministry_id", "int"),
    "ministry": ("ministry__name", "str"),
    "organization_id": ("ministry__organization_id", "int"),
    "organization": ("ministry__organization__name", "str"),
}

RECIPIENT_FIELDS = {
    "id": ("id", "int"),
    "name": ("name", "str"),
    "display_name": ("display_name", "str"),
    "is_placeholder": ("is_placeholder", "bool"),
}

AWARD_FIELDS = {
    "id": ("id", "int"),
    "reference": ("reference", "str"),
    "record_kind": ("record_kind", "str"),
    "amendment_number": ("amendment_number", "int"),
    "amendment_date": ("amendment_date", "date"),
    "is_current": ("is_current", "bool"),
    "agreement_type": ("agreement_type", "str"),
    "recipient_type": ("recipient_type", "str"),
    "recipient_province": ("recipient_province", "str"),
    "recipient_city": ("recipient_city", "str"),
    "value": ("value", "decimal"),
    "start_date": ("start_date", "date"),
    "start_date_estimated": ("start_date_estimated", "bool"),
    "end_date": ("end_date", "date"),
    "fiscal_year": ("fiscal_year", "fiscal_year"),
    "title": ("title", "str"),
    "description": ("description", "str"),
    "naics": ("naics", "str"),
    "business_unit": ("business_unit", "str"),
    "lottery_fund": ("lottery_fund", "bool"),
    "source_file": ("source_file", "str"),
    "import_date": ("import_date", "date"),
    # Relations (toward allowed models only)
    "ministry_id": ("ministry_id", "int"),
    "ministry": ("ministry__name", "str"),
    "organization_id": ("ministry__organization_id", "int"),
    "organization": ("ministry__organization__name", "str"),
    "program_id": ("program_id", "int"),
    "program": ("program__name", "str"),
    "recipient_id": ("recipient_id", "int"),
    "recipient": ("recipient__name", "str"),
    "recipient_display_name": ("recipient__display_name", "str"),
    "recipient_is_placeholder": ("recipient__is_placeholder", "bool"),
}

FISCAL_YEAR_FIELDS = {
    "id": ("id", "int"),
    "year": ("year", "int"),
    "start_date": ("start_date", "date"),
    "end_date": ("end_date", "date"),
}

FIELD_MAPS = {
    "organization": ORGANIZATION_FIELDS,
    "ministry": MINISTRY_FIELDS,
    "program": PROGRAM_FIELDS,
    "recipient": RECIPIENT_FIELDS,
    "award": AWARD_FIELDS,
    "fiscal_year": FISCAL_YEAR_FIELDS,
}

# Fields that may be the target of sum/avg (numeric only).
NUMERIC_TYPES = {"int", "decimal"}

FILTER_OPERATORS = [
    "eq", "ne", "contains", "startswith", "endswith",
    "gt", "gte", "lt", "lte", "in", "between", "isnull",
]
AGGREGATION_FUNCTIONS = ["count", "sum", "avg", "min", "max"]

ATTRIBUTION = {meta["name"]: meta["attribution"] for meta in ORGANIZATIONS.values()}

CONVENTIONS = {
    "fiscal_year": (
        "Both governments use an April-March fiscal year. FY2024 = Apr 1 2024 - Mar 31 2025. "
        "An award's fiscal_year is derived from start_date (a month before April belongs to "
        "the previous fiscal year). Filtering on fiscal_year is translated to a start_date range."
    ),
    "record_kinds": RECORD_KINDS,
    "do_not_mix": (
        "Government of Canada rows are agreements (total committed value, possibly spanning "
        "several years). Government of Alberta rows are cash payments on a date. Report them "
        "separately; a combined total of the two is not a meaningful measure of funding."
    ),
    "amendments": (
        "Federal agreements are disclosed once per amendment and each amendment restates the "
        "full value. Only is_current=true rows carry the latest value. Award tools and the "
        "query tool default to current_only=true; pass current_only=false only to inspect "
        "amendment history."
    ),
    "placeholders": (
        f"'{WITHHELD_INDIVIDUAL}' aggregates rows for individuals (federal recipient_type P, or "
        f"a name that looks like a person's); their names are not stored. "
        f"'{NOT_DISCLOSED}' holds rows the publisher released without a recipient; for Alberta "
        "these are large annual aggregates (e.g. physician fee-for-service, income support), "
        "about a quarter of all Alberta dollars. Both are counted in ministry/program totals "
        "but are not real recipients: exclude them (recipient_is_placeholder=false) when "
        "ranking recipients."
    ),
    "estimated_dates": (
        "start_date_estimated=true means the source gave no payment date and start_date is the "
        "first day of the disclosed fiscal year. Avoid month-level analysis of those rows."
    ),
    "names": (
        "Recipient.name is a normalised, upper-cased matching key (accents removed, '&' -> AND, "
        "legal forms unified: LIMITED -> LTD, INCORPORATED -> INC). display_name keeps the first "
        "spelling seen. The same organization can still appear under several names "
        "(e.g. 'GOVERNORS OF THE UNIVERSITY OF CALGARY' vs 'UNIVERSITY OF CALGARY'); search with "
        "contains and review the variants before totalling."
    ),
    "ministries": (
        "Alberta reports each payment under the ministry of the day, so reorganisations show up "
        "as separate ministries (e.g. Children's Services until 2023, then Children and Family "
        "Services). For multi-year trends by portfolio, look up the predecessor names with "
        "list_ministries and combine them, or group by program instead."
    ),
    "money": (
        "value is CAD. Alberta includes negative payments (reversals and recoveries) that net "
        "out in sums. Federal values are agreement totals, not amounts paid to date."
    ),
    "attribution": (
        "Data from the Government of Canada and the Government of Alberta under their Open "
        "Government Licences. Include the attribution line for each organization whose data "
        "appears in an answer."
    ),
}


def get_field_map(model_name):
    """Return the field map for an allowed model name or raise ValueError."""
    if model_name not in FIELD_MAPS:
        raise ValueError(
            f"Unknown or disallowed model '{model_name}'. Allowed models: {sorted(ALLOWED_MODELS)}"
        )
    return FIELD_MAPS[model_name]


def describe_schema():
    """A machine-readable description of everything the MCP server exposes."""

    def fields(model_name):
        return [{"name": name, "type": meta[1]} for name, meta in FIELD_MAPS[model_name].items()]

    return {
        "description": (
            "Read-only access to Canadian public grant disclosures: Government of Canada grants "
            "and contributions (agreements) and Government of Alberta grant payments. Exposes "
            "organizations, ministries, programs, recipients, awards and fiscal years. User "
            "accounts are not accessible."
        ),
        "conventions": CONVENTIONS,
        "organizations": [
            {
                "name": meta["name"],
                "record_kind": meta["record_kind"],
                "source": meta["source"],
                "source_url": meta["source_url"],
                "licence": meta["licence"],
                "attribution": meta["attribution"],
            }
            for meta in ORGANIZATIONS.values()
        ],
        "models": {
            "organization": {
                "fields": fields("organization"),
                "relations": {"ministries": "ministry (many)"},
            },
            "ministry": {
                "fields": fields("ministry"),
                "relations": {"organization": "organization (one)", "programs": "program (many)",
                              "awards": "award (many)"},
            },
            "program": {
                "fields": fields("program"),
                "relations": {"ministry": "ministry (one)", "awards": "award (many)"},
            },
            "recipient": {
                "fields": fields("recipient"),
                "relations": {"awards": "award (many)"},
            },
            "award": {
                "fields": fields("award"),
                "relations": {"ministry": "ministry (one)", "program": "program (one, optional)",
                              "recipient": "recipient (one)"},
            },
            "fiscal_year": {"fields": fields("fiscal_year"), "relations": {}},
        },
        "agreement_types": AGREEMENT_TYPES,
        "recipient_types": RECIPIENT_TYPES,
        "filter_operators": FILTER_OPERATORS,
        "aggregation_functions": AGGREGATION_FUNCTIONS,
    }
