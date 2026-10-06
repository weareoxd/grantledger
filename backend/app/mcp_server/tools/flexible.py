"""
Constrained, structured flexible-query tool plus the schema-description tool.

``query`` is a read-only ORM query builder: it validates the model, every field,
operator and aggregation against the schema allowlist before touching the ORM.
There is no raw SQL, no ``.raw()`` / ``.extra()``, and no path to write data or to
reach users or the OAuth tables.
"""

from typing import Any, Dict, List, Optional

from django.db.models import Avg, Count, Max, Min, Sum

from app.mcp_server import schema
from app.mcp_server.queries import (
    apply_filters,
    clamp_limit,
    fiscal_year_expr,
    jsonable_row,
    resolve_ordering,
    to_jsonable,
)
from app.mcp_server.server import tool

_AGG_FUNCS = {"count": Count, "sum": Sum, "avg": Avg, "min": Min, "max": Max}

# Long free-text fields left out of plain award rows unless asked for via ``fields``.
_HEAVY_FIELDS = {"award": {"description"}}


def _build_aggregations(aggregations, field_map):
    """Validate aggregation specs and return a dict of alias -> expression."""
    exprs = {}
    for spec in aggregations:
        if not isinstance(spec, dict):
            raise ValueError("Each aggregation must be an object with func, field and optional alias")
        func = spec.get("func")
        field = spec.get("field", "id")
        alias = spec.get("alias") or f"{func}_{field}"
        if func not in _AGG_FUNCS:
            raise ValueError(f"Invalid aggregation func '{func}'. Allowed: {sorted(_AGG_FUNCS)}")
        if field not in field_map:
            raise ValueError(f"Cannot aggregate field '{field}'. Allowed: {sorted(field_map)}")
        if not str(alias).isidentifier() or alias in field_map:
            raise ValueError(f"Alias '{alias}' must be an identifier that is not a field name")
        orm_path, ftype = field_map[field]
        if func in ("sum", "avg") and ftype not in schema.NUMERIC_TYPES:
            raise ValueError(f"{func} requires a numeric field; '{field}' is {ftype}")
        if ftype == "fiscal_year":
            raise ValueError("Aggregate fiscal_year by grouping on it instead")
        exprs[alias] = _AGG_FUNCS[func](orm_path)
    return exprs


@tool
def query(
    model: str,
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    group_by: Optional[List[str]] = None,
    aggregations: Optional[List[Dict[str, Any]]] = None,
    order_by: Optional[List[str]] = None,
    fields: Optional[List[str]] = None,
    current_only: bool = True,
    limit: int = 100,
) -> dict:
    """
    Flexible read-only query over an allowed model (organization, ministry, program,
    recipient, award, fiscal_year).

    - filters: [{"field","op","value"}] validated against the model's fields.
    - aggregations: [{"func","field","alias?"}] with func in count/sum/avg/min/max.
    - group_by: field names -> grouped rows of those fields plus the aggregations.
    - With aggregations and no group_by, returns a single totals object.
    - Without aggregations, returns rows; ``fields`` picks columns (award rows omit
      description unless requested).
    - current_only (award only, default true) hides superseded federal amendments.

    Call describe_schema for fields and conventions. Group or filter by organization
    or record_kind before summing award values: federal agreement totals and Alberta
    payments are different measures. Rows are capped by the server's MCP_MAX_ROWS.
    """
    if model not in schema.ALLOWED_MODELS:
        raise ValueError(
            f"Unknown or disallowed model '{model}'. Allowed: {sorted(schema.ALLOWED_MODELS)}"
        )
    model_cls = schema.ALLOWED_MODELS[model]
    field_map = schema.FIELD_MAPS[model]
    limit = clamp_limit(limit, default=100)

    qs = model_cls.objects.all()
    if model == "award" and current_only:
        qs = qs.filter(is_current=True)
    qs = apply_filters(qs, filters, field_map, combine)

    agg_exprs = _build_aggregations(aggregations, field_map) if aggregations else {}

    # Grouped aggregation. Select raw ORM paths, then rename keys back to friendly
    # names in Python: aliasing inside values()/annotate() would collide with real
    # model field names (id, ministry, recipient, ...).
    if group_by:
        invalid = [g for g in group_by if g not in field_map]
        if invalid:
            raise ValueError(f"Cannot group by {invalid}. Allowed: {sorted(field_map)}")
        qs, keys, rename = _select_paths(qs, group_by, field_map)
        if not agg_exprs:
            agg_exprs = {"count": Count("id")}
        rows = qs.values(*keys).annotate(**agg_exprs)
        # Order only by selected group keys or aggregation aliases: anything else
        # would be added to GROUP BY and fragment the groups.
        ordering = _grouped_ordering(order_by, rename, agg_exprs)
        if ordering:
            rows = rows.order_by(*ordering)
        return {
            "model": model,
            "group_by": group_by,
            "data": [_rename_row(r, rename) for r in rows[:limit]],
        }

    if agg_exprs:
        return {"model": model, "data": jsonable_row(qs.aggregate(**agg_exprs))}

    # Plain rows
    if fields:
        invalid = [f for f in fields if f not in field_map]
        if invalid:
            raise ValueError(f"Unknown field(s) {invalid}. Allowed: {sorted(field_map)}")
        names = list(fields)
    else:
        names = [f for f in field_map if f not in _HEAVY_FIELDS.get(model, set())]
    ordering = resolve_ordering(order_by, field_map) if order_by else []
    qs = qs.order_by(*ordering, "pk")
    qs, keys, rename = _select_paths(qs, names, field_map)
    rows = qs.values(*keys)[:limit]
    return {"model": model, "data": [_rename_row(r, rename) for r in rows]}


def _grouped_ordering(order_by, rename, agg_exprs):
    """Resolve order_by terms to selected group keys / aggregation aliases only."""
    allowed = {friendly: key for key, friendly in rename.items()}
    allowed.update({alias: alias for alias in agg_exprs})
    ordering = []
    for term in order_by or []:
        desc = term.startswith("-")
        name = term[1:] if desc else term
        if name not in allowed:
            raise ValueError(
                f"Cannot order grouped results by '{name}'. "
                f"Use a group_by field or an aggregation alias: {sorted(allowed)}"
            )
        col = allowed[name]
        ordering.append(f"-{col}" if desc else col)
    return ordering


def _select_paths(qs, names, field_map):
    """
    Resolve friendly field names to values() keys, annotating computed fields
    (fiscal_year) that have no column. Returns (queryset, keys, rename) where
    ``rename`` maps each key back to its friendly name.
    """
    keys, rename = [], {}
    for name in names:
        path, ftype = field_map[name]
        if ftype == "fiscal_year":
            ann = f"_fy_{name}"
            qs = qs.annotate(**{ann: fiscal_year_expr()})
            keys.append(ann)
            rename[ann] = name
        else:
            keys.append(path)
            rename[path] = name
    return qs, keys, rename


def _rename_row(row, rename):
    return {rename.get(key, key): to_jsonable(val) for key, val in row.items()}


@tool
def describe_schema() -> dict:
    """
    Describe the models, fields, relationships, conventions (fiscal years, record
    kinds, amendments, placeholders, name matching, attribution), code tables and the
    available filter operators / aggregation functions. Call this first.
    """
    return schema.describe_schema()
