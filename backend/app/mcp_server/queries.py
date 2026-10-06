"""
Reusable read-only query helpers shared by the MCP tools: the fiscal-year
convention, a structured-filter parser validated against the schema allowlist,
pagination clamping and JSON-safe value conversion.
"""

from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.db.models import Case, IntegerField, Q, When
from django.db.models.functions import ExtractYear

# Fiscal year starts in April; a date before April belongs to the previous fiscal year.
FISCAL_YEAR_START_MONTH = 4


def fiscal_year_expr():
    """Annotation expression deriving the fiscal year from ``start_date``."""
    return Case(
        When(start_date__month__lt=FISCAL_YEAR_START_MONTH, then=ExtractYear("start_date") - 1),
        default=ExtractYear("start_date"),
        output_field=IntegerField(),
    )


def fiscal_year_bounds(fiscal_year):
    """(start_date, end_date) of a fiscal year: 2024 -> Apr 1 2024 .. Mar 31 2025."""
    return date(fiscal_year, 4, 1), date(fiscal_year + 1, 3, 31)


def fiscal_range_q(fiscal_year_from=None, fiscal_year_to=None, prefix=""):
    """Q restricting ``<prefix>start_date`` to an inclusive fiscal-year range."""
    q = Q()
    if fiscal_year_from is not None:
        q &= Q(**{f"{prefix}start_date__gte": fiscal_year_bounds(int(fiscal_year_from))[0]})
    if fiscal_year_to is not None:
        q &= Q(**{f"{prefix}start_date__lte": fiscal_year_bounds(int(fiscal_year_to))[1]})
    return q


# ---------------------------------------------------------------------------
# JSON-safe conversion
# ---------------------------------------------------------------------------
def to_jsonable(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def jsonable_row(row):
    return {key: to_jsonable(val) for key, val in row.items()}


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------
# op -> (lookup suffix, negate)
_OP_LOOKUPS = {
    "eq": ("", False),
    "ne": ("", True),
    "contains": ("__icontains", False),
    "startswith": ("__istartswith", False),
    "endswith": ("__iendswith", False),
    "gt": ("__gt", False),
    "gte": ("__gte", False),
    "lt": ("__lt", False),
    "lte": ("__lte", False),
    "in": ("__in", False),
    "between": ("__range", False),
    "isnull": ("__isnull", False),
}


def _fiscal_year_q(op, value):
    """Translate a fiscal_year filter into start_date conditions."""
    if op in ("eq", "in", "between"):
        if op == "between":
            lo, hi = int(value[0]), int(value[1])
        elif op == "in":
            years = sorted({int(v) for v in value})
            q = Q()
            for year in years:
                start, end = fiscal_year_bounds(year)
                q |= Q(start_date__gte=start, start_date__lte=end)
            return q
        else:
            lo = hi = int(value)
        start, _ = fiscal_year_bounds(lo)
        _, end = fiscal_year_bounds(hi)
        return Q(start_date__gte=start, start_date__lte=end)

    if op == "ne":
        start, end = fiscal_year_bounds(int(value))
        return ~Q(start_date__gte=start, start_date__lte=end)
    year = int(value)
    start, end = fiscal_year_bounds(year)
    if op == "gt":
        return Q(start_date__gt=end)
    if op == "gte":
        return Q(start_date__gte=start)
    if op == "lt":
        return Q(start_date__lt=start)
    if op == "lte":
        return Q(start_date__lte=end)
    raise ValueError(f"Operator '{op}' is not supported for fiscal_year")


def _build_q(orm_path, ftype, op, value):
    if op not in _OP_LOOKUPS:
        raise ValueError(f"Unknown filter operator '{op}'. Allowed: {sorted(_OP_LOOKUPS)}")
    if ftype == "fiscal_year":
        return _fiscal_year_q(op, value)

    suffix, negate = _OP_LOOKUPS[op]
    if op == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            raise ValueError("'between' needs a [low, high] pair")
        value = tuple(value)
    elif op == "in":
        if not isinstance(value, (list, tuple)):
            raise ValueError("'in' needs a list of values")
    elif op == "isnull":
        value = bool(value)
    q = Q(**{f"{orm_path}{suffix}": value})
    return ~q if negate else q


def apply_filters(queryset, filters, field_map, combine="and"):
    """
    Apply ``[{"field", "op", "value"}]`` filters, validated against ``field_map``.

    Unknown fields raise ValueError so an LLM can never reach a non-allowlisted
    column. ``combine`` is "and" (default) or "or" across the filters.
    """
    if not filters:
        return queryset
    if combine not in ("and", "or"):
        raise ValueError("combine must be 'and' or 'or'")

    combined = None
    for flt in filters:
        if not isinstance(flt, dict):
            raise ValueError("Each filter must be an object with field, op and value")
        field = flt.get("field")
        op = flt.get("op", "eq")
        value = flt.get("value")
        if field not in field_map:
            raise ValueError(
                f"Field '{field}' is not filterable on this model. Allowed fields: {sorted(field_map)}"
            )
        orm_path, ftype = field_map[field]
        q = _build_q(orm_path, ftype, op, value)
        if combined is None:
            combined = q
        elif combine == "or":
            combined |= q
        else:
            combined &= q
    return queryset.filter(combined)


def resolve_ordering(order_by, field_map):
    """Validate and translate ``order_by`` names (optionally ``-``-prefixed) to ORM paths."""
    resolved = []
    for term in order_by or []:
        desc = term.startswith("-")
        name = term[1:] if desc else term
        if name not in field_map:
            raise ValueError(f"Cannot order by '{name}'. Allowed fields: {sorted(field_map)}")
        orm_path, ftype = field_map[name]
        if ftype == "fiscal_year":
            orm_path = "start_date"
        resolved.append(f"-{orm_path}" if desc else orm_path)
    return resolved


def resolved_max_rows():
    """
    The configured row cap as a positive int, or None for unlimited.

    MCP_MAX_ROWS may be an int or a string (env var). Blank / "none" / "null" /
    a non-positive number all mean "no cap".
    """
    raw = settings.MCP_MAX_ROWS
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    text = str(raw).strip().lower()
    if text in ("", "none", "null", "unlimited"):
        return None
    try:
        value = int(text)
    except ValueError:
        return None
    return value if value > 0 else None


def clamp_limit(limit, default=50):
    """Clamp a requested row limit to [1, MCP_MAX_ROWS] (no upper cap if unlimited)."""
    max_rows = resolved_max_rows()
    if limit is None:
        limit = default
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = default
    limit = max(1, limit)
    if max_rows is not None:
        limit = min(limit, max_rows)
    return limit


def clamp_offset(offset):
    try:
        offset = int(offset)
    except (TypeError, ValueError):
        return 0
    return max(0, offset)
