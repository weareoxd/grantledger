"""
Curated record-listing and lookup tools (organizations, ministries, programs,
recipients, awards, fiscal years). Read-only; all filtering goes through the
schema allowlist in ``apply_filters``.
"""

from typing import Any, Dict, List, Optional

from django.core.cache import cache
from django.db.models import Q

from app.core.cache import make_key
from app.grants.constants import ORGANIZATIONS
from app.grants.models import Award, FiscalYear, Ministry, Organization, Program, Recipient
from app.grants.normalize import normalize_name
from app.mcp_server import schema
from app.mcp_server.queries import (
    apply_filters,
    clamp_limit,
    clamp_offset,
    resolve_ordering,
    to_jsonable,
)
from app.mcp_server.server import tool

LIST_DESCRIPTION_CHARS = 300


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------
def _project(data: dict, fields: Optional[List[str]]) -> dict:
    if not fields:
        return data
    invalid = [f for f in fields if f not in data]
    if invalid:
        raise ValueError(f"Unknown field(s) {invalid}. Available: {sorted(data)}")
    return {f: data[f] for f in fields}


def _organization_dict(o: Organization) -> dict:
    meta = ORGANIZATIONS.get(o.key, {})
    return {
        "id": o.id,
        "name": o.name,
        "record_kind": meta.get("record_kind"),
        "source": meta.get("source"),
        "source_url": meta.get("source_url"),
        "licence": meta.get("licence"),
        "attribution": meta.get("attribution"),
    }


def _ministry_dict(m: Ministry) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "organization_id": m.organization_id,
        "organization": m.organization.name,
    }


def _program_dict(p: Program) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "ministry_id": p.ministry_id,
        "ministry": p.ministry.name,
        "organization_id": p.ministry.organization_id,
        "organization": p.ministry.organization.name,
    }


def _recipient_dict(r: Recipient) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "display_name": r.display_name,
        "is_placeholder": r.is_placeholder,
    }


def _award_dict(a: Award, truncate_description=False) -> dict:
    description = a.description
    if truncate_description and description and len(description) > LIST_DESCRIPTION_CHARS:
        description = description[:LIST_DESCRIPTION_CHARS].rstrip() + "…"
    return {
        "id": a.id,
        "reference": a.reference,
        "record_kind": a.record_kind,
        "amendment_number": a.amendment_number,
        "amendment_date": to_jsonable(a.amendment_date),
        "is_current": a.is_current,
        "agreement_type": a.agreement_type,
        "recipient_type": a.recipient_type,
        "recipient_province": a.recipient_province,
        "recipient_city": a.recipient_city,
        "value": to_jsonable(a.value),
        "start_date": to_jsonable(a.start_date),
        "start_date_estimated": a.start_date_estimated,
        "end_date": to_jsonable(a.end_date),
        "fiscal_year": a.fiscal_year,
        "title": a.title,
        "description": description,
        "naics": a.naics,
        "business_unit": a.business_unit,
        "lottery_fund": a.lottery_fund,
        "source_file": a.source_file,
        "import_date": to_jsonable(a.import_date),
        "ministry_id": a.ministry_id,
        "ministry": a.ministry.name,
        "organization_id": a.ministry.organization_id,
        "organization": a.ministry.organization.name,
        "program_id": a.program_id,
        "program": a.program.name if a.program_id else None,
        "recipient_id": a.recipient_id,
        "recipient": a.recipient.name,
        "recipient_display_name": a.recipient.display_name,
        "recipient_is_placeholder": a.recipient.is_placeholder,
    }


def _fiscal_year_dict(fy: FiscalYear) -> dict:
    return {
        "id": fy.id,
        "year": fy.year,
        "start_date": to_jsonable(fy.start_date),
        "end_date": to_jsonable(fy.end_date),
    }


def _paginated(queryset, serializer, fields, limit, offset):
    limit = clamp_limit(limit)
    offset = clamp_offset(offset)
    # The COUNT over a large filtered set is the expensive half of a list call and
    # identical across pages: key it on the ordering-less SQL so offset walks and
    # sort permutations share one entry. The data version in make_key invalidates it.
    count_qs = queryset.order_by()
    count_key = make_key("mcp_count", str(count_qs.query))
    total = cache.get(count_key)
    if total is None:
        total = count_qs.count()
        cache.set(count_key, total)
    rows = [serializer(obj) for obj in queryset[offset : offset + limit]]
    if fields:
        rows = [_project(r, fields) for r in rows]
    return {"count": total, "limit": limit, "offset": offset, "data": rows}


def _award_queryset(current_only):
    qs = Award.objects.select_related("ministry__organization", "program", "recipient")
    return qs.filter(is_current=True) if current_only else qs


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
@tool
def list_organizations(limit: int = 50, offset: int = 0) -> dict:
    """List the publishing governments, with each one's source dataset, licence and attribution line."""
    qs = Organization.objects.order_by("name", "pk")
    return _paginated(qs, _organization_dict, None, limit, offset)


@tool
def get_organization(id: int) -> dict:
    """Get one organization (publishing government) by id."""
    return _organization_dict(Organization.objects.get(id=id))


@tool
def list_ministries(
    organization_id: Optional[int] = None,
    search: Optional[str] = None,
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    fields: Optional[List[str]] = None,
    sort: Optional[List[str]] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List ministries / federal departments, optionally scoped to an organization or name search."""
    qs = Ministry.objects.select_related("organization")
    if organization_id is not None:
        qs = qs.filter(organization_id=organization_id)
    if search:
        qs = qs.filter(name__icontains=search)
    qs = apply_filters(qs, filters, schema.MINISTRY_FIELDS, combine)
    qs = qs.order_by(*(resolve_ordering(sort, schema.MINISTRY_FIELDS) or ["name"]), "pk")
    return _paginated(qs, _ministry_dict, fields, limit, offset)


@tool
def get_ministry(id: int) -> dict:
    """Get one ministry / federal department by id."""
    return _ministry_dict(Ministry.objects.select_related("organization").get(id=id))


@tool
def list_programs(
    ministry_id: Optional[int] = None,
    organization_id: Optional[int] = None,
    search: Optional[str] = None,
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    fields: Optional[List[str]] = None,
    sort: Optional[List[str]] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List funding programs, optionally scoped to a ministry or organization, or by name search."""
    qs = Program.objects.select_related("ministry__organization")
    if ministry_id is not None:
        qs = qs.filter(ministry_id=ministry_id)
    if organization_id is not None:
        qs = qs.filter(ministry__organization_id=organization_id)
    if search:
        qs = qs.filter(name__icontains=search)
    qs = apply_filters(qs, filters, schema.PROGRAM_FIELDS, combine)
    qs = qs.order_by(*(resolve_ordering(sort, schema.PROGRAM_FIELDS) or ["name"]), "pk")
    return _paginated(qs, _program_dict, fields, limit, offset)


@tool
def get_program(id: int) -> dict:
    """Get one program by id."""
    return _program_dict(Program.objects.select_related("ministry__organization").get(id=id))


@tool
def list_recipients(
    search: Optional[str] = None,
    include_placeholders: bool = False,
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    fields: Optional[List[str]] = None,
    sort: Optional[List[str]] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """
    List funding recipients. ``search`` is matched against the normalised name and
    the original spelling, case- and accent-insensitively. Placeholder recipients
    (withheld individuals, undisclosed) are excluded unless include_placeholders=true.
    Several entries can be the same organization under different names: review them.
    """
    qs = Recipient.objects.all()
    if not include_placeholders:
        qs = qs.filter(is_placeholder=False)
    if search:
        qs = qs.filter(Q(name__icontains=normalize_name(search) or search) | Q(display_name__icontains=search))
    qs = apply_filters(qs, filters, schema.RECIPIENT_FIELDS, combine)
    qs = qs.order_by(*(resolve_ordering(sort, schema.RECIPIENT_FIELDS) or ["name"]), "pk")
    return _paginated(qs, _recipient_dict, fields, limit, offset)


@tool
def get_recipient(id: int) -> dict:
    """Get one recipient by id."""
    return _recipient_dict(Recipient.objects.get(id=id))


@tool
def list_awards(
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    fields: Optional[List[str]] = None,
    sort: Optional[List[str]] = None,
    current_only: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """
    List awards (federal agreements and Alberta payments) with structured filters,
    newest start_date first. Filterable fields include organization, ministry,
    program, recipient, value, fiscal_year, record_kind, agreement_type and
    recipient_type (see describe_schema). current_only=true (default) hides
    superseded federal amendments. Descriptions are cut to 300 characters here;
    get_award returns the full text. Pass ``fields`` to keep responses small.
    """
    qs = apply_filters(_award_queryset(current_only), filters, schema.AWARD_FIELDS, combine)
    # The trailing pk keeps offset pagination deterministic when the sort column ties.
    qs = qs.order_by(*(resolve_ordering(sort, schema.AWARD_FIELDS) or ["-start_date"]), "pk")
    return _paginated(
        qs, lambda a: _award_dict(a, truncate_description=True), fields, limit, offset
    )


@tool
def get_award(id: int) -> dict:
    """
    Get one award by id with full text. For a federal agreement, ``amendments``
    lists every disclosed version of it (value restated on each).
    """
    award = _award_queryset(False).get(id=id)
    data = _award_dict(award)
    if award.record_kind == Award.AGREEMENT:
        data["amendments"] = [
            {
                "id": a["id"],
                "amendment_number": a["amendment_number"],
                "amendment_date": to_jsonable(a["amendment_date"]),
                "value": to_jsonable(a["value"]),
                "is_current": a["is_current"],
            }
            for a in Award.objects.filter(
                ministry_id=award.ministry_id, reference=award.reference, record_kind=Award.AGREEMENT
            )
            .order_by("amendment_number", "id")
            .values("id", "amendment_number", "amendment_date", "value", "is_current")
        ]
    return data


@tool
def list_fiscal_years() -> dict:
    """List the fiscal years covered (year, start_date, end_date). FY2024 = Apr 2024 - Mar 2025."""
    rows = [_fiscal_year_dict(fy) for fy in FiscalYear.objects.order_by("-year")]
    return {"count": len(rows), "data": rows}
