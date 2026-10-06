"""
Curated aggregation tools for the questions people ask most: totals by a
dimension, one recipient's funding across governments, one ministry's funding,
and recipients funded by both governments.

Every money total is reported three ways: ``agreement_value`` (federal agreement
totals), ``payment_value`` (Alberta cash payments) and their arithmetic sum
``total_value``. The split is always present so a combined figure is never
mistaken for a like-for-like measure.
"""

from typing import Any, Dict, List, Optional

from django.db.models import Count, F, Q, Sum

from app.grants.models import Award, Ministry, Organization, Recipient
from app.grants.normalize import normalize_name
from app.mcp_server import schema
from app.mcp_server.cache import cached_result
from app.mcp_server.queries import (
    apply_filters,
    clamp_limit,
    fiscal_range_q,
    fiscal_year_expr,
    to_jsonable,
)
from app.mcp_server.server import tool

# group_by name -> (values() columns, output names). The first column is the group label.
_GROUP_BY = {
    "organization": (["ministry__organization__name", "ministry__organization_id"], ["group", "group_id"]),
    "ministry": (
        ["ministry__name", "ministry_id", "ministry__organization__name"],
        ["group", "group_id", "organization"],
    ),
    "program": (
        ["program__name", "program_id", "ministry__name", "ministry__organization__name"],
        ["group", "group_id", "ministry", "organization"],
    ),
    "recipient": (
        ["recipient__name", "recipient_id", "recipient__display_name", "recipient__is_placeholder"],
        ["group", "group_id", "display_name", "is_placeholder"],
    ),
    "record_kind": (["record_kind"], ["group"]),
    "agreement_type": (["agreement_type"], ["group"]),
    "recipient_type": (["recipient_type"], ["group"]),
    "recipient_province": (["recipient_province"], ["group"]),
    "fiscal_year": (["_fy"], ["group"]),
}


def _sums():
    return {
        "award_count": Count("id"),
        "total_value": Sum("value"),
        "agreement_value": Sum("value", filter=Q(record_kind=Award.AGREEMENT)),
        "payment_value": Sum("value", filter=Q(record_kind=Award.PAYMENT)),
    }


def _money(row):
    return {
        "award_count": row["award_count"],
        "agreement_value": to_jsonable(row["agreement_value"]),
        "payment_value": to_jsonable(row["payment_value"]),
        "total_value": to_jsonable(row["total_value"]),
    }


def _awards(current_only=True):
    qs = Award.objects.all()
    return qs.filter(is_current=True) if current_only else qs


def _by_fiscal_year(queryset):
    rows = (
        queryset.annotate(_fy=fiscal_year_expr())
        .values("_fy", "ministry__organization__name")
        .annotate(**_sums())
        .order_by("_fy", "ministry__organization__name")
    )
    return [
        {"fiscal_year": r["_fy"], "organization": r["ministry__organization__name"], **_money(r)}
        for r in rows
    ]


def _by_organization(queryset):
    rows = (
        queryset.values("ministry__organization__name")
        .annotate(**_sums())
        .order_by("ministry__organization__name")
    )
    return [{"organization": r["ministry__organization__name"], **_money(r)} for r in rows]


@tool
@cached_result
def award_totals(
    group_by: str,
    filters: Optional[List[Dict[str, Any]]] = None,
    combine: str = "and",
    current_only: bool = True,
    include_placeholders: Optional[bool] = None,
    limit: int = 50,
) -> dict:
    """
    Award count and value grouped by one dimension, highest total first.

    ``group_by`` is one of: organization, ministry, program, recipient, record_kind,
    agreement_type, recipient_type, recipient_province, fiscal_year. ``filters`` use
    the same structured format as list_awards. Placeholder recipients are excluded
    when grouping by recipient and included otherwise, unless include_placeholders
    says so. Each group reports agreement_value (federal), payment_value (Alberta)
    and total_value.
    """
    if group_by not in _GROUP_BY:
        raise ValueError(f"Invalid group_by '{group_by}'. Allowed: {sorted(_GROUP_BY)}")
    if include_placeholders is None:
        include_placeholders = group_by != "recipient"

    qs = apply_filters(_awards(current_only), filters, schema.AWARD_FIELDS, combine)
    if not include_placeholders:
        qs = qs.filter(recipient__is_placeholder=False)
    if group_by == "fiscal_year":
        qs = qs.annotate(_fy=fiscal_year_expr())

    columns, names = _GROUP_BY[group_by]
    rows = (
        qs.values(*columns)
        .annotate(**_sums())
        .order_by(F("total_value").desc(nulls_last=True), *columns)[: clamp_limit(limit)]
    )
    data = [
        {**{n: to_jsonable(r[c]) for c, n in zip(columns, names)}, **_money(r)} for r in rows
    ]
    return {"group_by": group_by, "current_only": current_only, "data": data}


def _resolve_recipient(recipient_id, recipient_name):
    if recipient_id is not None:
        return Recipient.objects.get(id=recipient_id)
    if not recipient_name:
        raise ValueError("Provide recipient_id or recipient_name")
    key = normalize_name(recipient_name)
    recipient = Recipient.objects.filter(name=key).first()
    if recipient is not None:
        return recipient
    close = list(
        Recipient.objects.filter(name__icontains=key, is_placeholder=False)
        .order_by("name")
        .values_list("name", flat=True)[:10]
    )
    raise ValueError(
        f"No recipient named '{recipient_name}' (matching key '{key}'). "
        f"Names containing it: {close or 'none'}. Use list_recipients(search=...) to find the id."
    )


@tool
@cached_result
def recipient_funding(
    recipient_id: Optional[int] = None,
    recipient_name: Optional[str] = None,
    fiscal_year_from: Optional[int] = None,
    fiscal_year_to: Optional[int] = None,
    top_programs: int = 10,
) -> dict:
    """
    Funding summary for one recipient across both governments: totals per
    organization, per fiscal year, the top programs, and other recipient names
    that contain this one (possible variants of the same organization, which are
    NOT included in the totals). Identify the recipient by id or exact name
    (case, accents and legal-form spelling are normalised). Current amendments only.
    """
    recipient = _resolve_recipient(recipient_id, recipient_name)
    qs = _awards().filter(recipient=recipient).filter(fiscal_range_q(fiscal_year_from, fiscal_year_to))
    programs = (
        qs.values("program__name", "ministry__name", "ministry__organization__name")
        .annotate(**_sums())
        .order_by(F("total_value").desc(nulls_last=True))[: clamp_limit(top_programs)]
    )
    variants = (
        Recipient.objects.filter(name__icontains=recipient.name, is_placeholder=False)
        .exclude(id=recipient.id)
        .order_by("name")
        .values("id", "name")[:10]
    )
    return {
        "recipient": {
            "id": recipient.id,
            "name": recipient.name,
            "display_name": recipient.display_name,
            "is_placeholder": recipient.is_placeholder,
        },
        "fiscal_year_from": fiscal_year_from,
        "fiscal_year_to": fiscal_year_to,
        "by_organization": _by_organization(qs),
        "by_fiscal_year": _by_fiscal_year(qs),
        "top_programs": [
            {
                "program": r["program__name"],
                "ministry": r["ministry__name"],
                "organization": r["ministry__organization__name"],
                **_money(r),
            }
            for r in programs
        ],
        "possible_variants": list(variants),
    }


@tool
@cached_result
def ministry_funding(
    ministry_id: int,
    fiscal_year_from: Optional[int] = None,
    fiscal_year_to: Optional[int] = None,
    top_recipients: int = 10,
    top_programs: int = 10,
) -> dict:
    """
    Funding summary for one ministry / federal department: totals, by fiscal year,
    top programs, and top recipients (placeholders excluded from the ranking but
    reported separately in placeholder_totals). Current amendments only.
    """
    ministry = Ministry.objects.select_related("organization").get(id=ministry_id)
    qs = _awards().filter(ministry=ministry).filter(fiscal_range_q(fiscal_year_from, fiscal_year_to))
    totals = qs.aggregate(**_sums())
    recipients = (
        qs.filter(recipient__is_placeholder=False)
        .values("recipient_id", "recipient__name")
        .annotate(**_sums())
        .order_by(F("total_value").desc(nulls_last=True))[: clamp_limit(top_recipients)]
    )
    placeholders = (
        qs.filter(recipient__is_placeholder=True)
        .values("recipient__name")
        .annotate(**_sums())
        .order_by("recipient__name")
    )
    programs = (
        qs.values("program_id", "program__name")
        .annotate(**_sums())
        .order_by(F("total_value").desc(nulls_last=True))[: clamp_limit(top_programs)]
    )
    by_year = (
        qs.annotate(_fy=fiscal_year_expr()).values("_fy").annotate(**_sums()).order_by("_fy")
    )
    return {
        "ministry": {
            "id": ministry.id,
            "name": ministry.name,
            "organization": ministry.organization.name,
        },
        "fiscal_year_from": fiscal_year_from,
        "fiscal_year_to": fiscal_year_to,
        "totals": _money(totals),
        "recipient_count": qs.values("recipient_id").distinct().count(),
        "by_fiscal_year": [{"fiscal_year": r["_fy"], **_money(r)} for r in by_year],
        "top_programs": [
            {"program_id": r["program_id"], "program": r["program__name"], **_money(r)} for r in programs
        ],
        "top_recipients": [
            {"recipient_id": r["recipient_id"], "recipient": r["recipient__name"], **_money(r)}
            for r in recipients
        ],
        "placeholder_totals": [{"recipient": r["recipient__name"], **_money(r)} for r in placeholders],
    }


@tool
@cached_result
def shared_recipients(
    fiscal_year_from: Optional[int] = None,
    fiscal_year_to: Optional[int] = None,
    search: Optional[str] = None,
    order_by: str = "combined",
    min_value_each: Optional[float] = None,
    limit: int = 50,
) -> dict:
    """
    Recipients funded by more than one government in the period, with each
    government's amount side by side. ``order_by`` is "combined" (arithmetic sum,
    default) or an organization name such as "Government of Alberta".
    ``min_value_each`` keeps recipients whose amount from every funder is at least
    that value. ``search`` keeps recipients whose name contains it (e.g. "FIRST
    NATION"). Placeholders are excluded. Exact-name matches only: an organization
    spelled differently in the two sources will not appear (see list_recipients).
    """
    orgs = list(Organization.objects.order_by("name"))
    qs = _awards().filter(recipient__is_placeholder=False).filter(
        fiscal_range_q(fiscal_year_from, fiscal_year_to)
    )
    if search:
        qs = qs.filter(recipient__name__icontains=normalize_name(search) or search)
    per_org = {}
    for org in orgs:
        per_org[f"v{org.id}"] = Sum("value", filter=Q(ministry__organization_id=org.id))
        per_org[f"n{org.id}"] = Count("id", filter=Q(ministry__organization_id=org.id))
    rows = (
        qs.values("recipient_id", "recipient__name")
        .annotate(
            funder_count=Count("ministry__organization_id", distinct=True),
            total_value=Sum("value"),
            **per_org,
        )
        .filter(funder_count__gte=2)
    )
    if min_value_each is not None:
        for org in orgs:
            rows = rows.filter(**{f"v{org.id}__gte": min_value_each})

    if order_by == "combined":
        ordering = F("total_value").desc(nulls_last=True)
    else:
        match = next((o for o in orgs if o.name.lower() == str(order_by).lower()), None)
        if match is None:
            raise ValueError(
                f"order_by must be 'combined' or one of {[o.name for o in orgs]}"
            )
        ordering = F(f"v{match.id}").desc(nulls_last=True)

    total = rows.count()
    data = []
    for r in rows.order_by(ordering, "recipient__name")[: clamp_limit(limit)]:
        data.append(
            {
                "recipient_id": r["recipient_id"],
                "recipient": r["recipient__name"],
                "funding": [
                    {
                        "organization": org.name,
                        "value": to_jsonable(r[f"v{org.id}"]),
                        "award_count": r[f"n{org.id}"],
                    }
                    for org in orgs
                ],
                "combined_value": to_jsonable(r["total_value"]),
            }
        )
    return {
        "fiscal_year_from": fiscal_year_from,
        "fiscal_year_to": fiscal_year_to,
        "recipient_count": total,
        "data": data,
    }
