"""
Tests for the read-only MCP tools. They call the underlying sync tool functions
directly (see server.tool) and focus on what matters for an LLM-facing surface:
correct numbers under the data conventions, the allowlist as a hard boundary,
the row cap, and caching.
"""

from datetime import date

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from app.core.cache import bump_version
from app.grants.models import Award, FiscalYear, Ministry, Organization, Program, Recipient
from app.grants.normalize import NOT_DISCLOSED, WITHHELD_INDIVIDUAL
from app.mcp_server import schema
from app.mcp_server.tools import aggregates, flexible, records


class GrantsFixture:
    @classmethod
    def build(cls, target):
        target.fed = Organization.objects.create(key="federal", name="Government of Canada")
        target.ab = Organization.objects.create(key="alberta", name="Government of Alberta")
        target.dept = Ministry.objects.create(organization=target.fed, name="Example Agency Canada")
        target.health = Ministry.objects.create(organization=target.ab, name="Health")
        target.culture = Ministry.objects.create(organization=target.ab, name="Culture")
        target.fed_prog = Program.objects.create(ministry=target.dept, name="Community Program")
        target.ab_prog = Program.objects.create(ministry=target.culture, name="CFEP")
        target.ffs = Program.objects.create(ministry=target.health, name="FEE FOR SERVICE")

        target.shared = Recipient.objects.create(name="EXAMPLE SOCIETY", display_name="Example Society")
        target.fed_only = Recipient.objects.create(name="NATIONAL WIDGETS INC", display_name="National Widgets Inc.")
        target.variant = Recipient.objects.create(
            name="EXAMPLE SOCIETY OF CALGARY", display_name="EXAMPLE SOCIETY OF CALGARY"
        )
        target.withheld = Recipient.objects.create(
            name=WITHHELD_INDIVIDUAL, display_name=WITHHELD_INDIVIDUAL, is_placeholder=True
        )
        target.undisclosed = Recipient.objects.create(
            name=NOT_DISCLOSED, display_name=NOT_DISCLOSED, is_placeholder=True
        )

        def agreement(ref, amend, value, start, recipient, current, rtype="N"):
            return Award.objects.create(
                ministry=target.dept, program=target.fed_prog, recipient=recipient,
                record_kind=Award.AGREEMENT, reference=ref, amendment_number=amend,
                is_current=current, agreement_type="C", recipient_type=rtype,
                value=value, start_date=start, description="x" * 1000,
            )

        def payment(ministry, program, recipient, value, start, estimated=False):
            return Award.objects.create(
                ministry=ministry, program=program, recipient=recipient,
                record_kind=Award.PAYMENT, reference=f"AB-{start.year}-{Award.objects.count():07d}",
                value=value, start_date=start, start_date_estimated=estimated,
            )

        # Federal: one agreement amended (100 -> 150), one other agreement, one individual.
        agreement("F1", 0, 100, date(2024, 5, 1), target.shared, current=False)
        agreement("F1", 1, 150, date(2024, 5, 1), target.shared, current=True)
        agreement("F2", 0, 1000, date(2025, 2, 1), target.fed_only, current=True, rtype="F")
        agreement("F3", 0, 20, date(2024, 6, 1), target.withheld, current=True, rtype="P")

        # Alberta: payments to the shared recipient (incl. a reversal), a variant
        # spelling, and a huge undisclosed aggregate with an estimated date.
        payment(target.culture, target.ab_prog, target.shared, 40, date(2024, 4, 2))
        payment(target.culture, target.ab_prog, target.shared, -10, date(2024, 7, 2))
        payment(target.culture, target.ab_prog, target.variant, 5, date(2024, 8, 2))
        payment(target.health, target.ffs, target.undisclosed, 1_000_000, date(2024, 4, 1), estimated=True)

        FiscalYear.objects.create(year=2024, start_date=date(2024, 4, 1), end_date=date(2025, 3, 31))


class MCPToolsTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        GrantsFixture.build(cls)

    def setUp(self):
        # TestCase never commits, so on_commit(bump_version) never fires: clear the
        # LocMem cache so results do not leak across tests with different data.
        cache.clear()

    # -- records ----------------------------------------------------------------
    def test_list_organizations_carry_licence_and_attribution(self):
        result = records.list_organizations()
        by_name = {o["name"]: o for o in result["data"]}
        self.assertEqual(by_name["Government of Alberta"]["record_kind"], "payment")
        self.assertIn("Open Government Licence – Canada", by_name["Government of Canada"]["attribution"])

    def test_list_awards_hides_superseded_amendments_by_default(self):
        current = records.list_awards(filters=[{"field": "reference", "op": "eq", "value": "F1"}])
        self.assertEqual([a["value"] for a in current["data"]], [150.0])
        history = records.list_awards(
            filters=[{"field": "reference", "op": "eq", "value": "F1"}], current_only=False
        )
        self.assertEqual(history["count"], 2)

    def test_list_awards_truncates_descriptions_and_projects_fields(self):
        result = records.list_awards(
            filters=[{"field": "organization", "op": "eq", "value": "Government of Canada"}], limit=1
        )
        self.assertLess(len(result["data"][0]["description"]), 400)
        projected = records.list_awards(fields=["reference", "value"], limit=1)
        self.assertEqual(set(projected["data"][0]), {"reference", "value"})

    def test_get_award_includes_amendment_history_and_full_text(self):
        award = Award.objects.get(reference="F1", is_current=True)
        result = records.get_award(id=award.id)
        self.assertEqual([a["value"] for a in result["amendments"]], [100.0, 150.0])
        self.assertEqual(len(result["description"]), 1000)

    def test_fiscal_year_filter(self):
        # Feb 2025 belongs to FY2024; nothing falls in FY2023.
        result = records.list_awards(filters=[{"field": "fiscal_year", "op": "eq", "value": 2024}])
        self.assertEqual(result["count"], 7)
        none = records.list_awards(filters=[{"field": "fiscal_year", "op": "eq", "value": 2023}])
        self.assertEqual(none["count"], 0)

    def test_list_recipients_search_normalises_and_hides_placeholders(self):
        result = records.list_recipients(search="example société")
        self.assertEqual(result["count"], 0)  # no such name, but search must not error
        result = records.list_recipients(search="Example Society")
        self.assertEqual({r["name"] for r in result["data"]}, {"EXAMPLE SOCIETY", "EXAMPLE SOCIETY OF CALGARY"})
        everyone = records.list_recipients(include_placeholders=True)
        self.assertEqual(everyone["count"], 5)

    # -- aggregates -------------------------------------------------------------
    def test_award_totals_by_organization_split_by_kind(self):
        result = aggregates.award_totals(group_by="organization")
        by_org = {r["group"]: r for r in result["data"]}
        self.assertEqual(by_org["Government of Canada"]["agreement_value"], 1170.0)  # 150 + 1000 + 20
        self.assertIsNone(by_org["Government of Canada"]["payment_value"])
        self.assertEqual(by_org["Government of Alberta"]["payment_value"], 1_000_035.0)

    def test_award_totals_by_recipient_excludes_placeholders_by_default(self):
        result = aggregates.award_totals(group_by="recipient")
        names = [r["group"] for r in result["data"]]
        self.assertNotIn(NOT_DISCLOSED, names)
        self.assertNotIn(WITHHELD_INDIVIDUAL, names)
        self.assertEqual(names[0], "NATIONAL WIDGETS INC")
        shared = next(r for r in result["data"] if r["group"] == "EXAMPLE SOCIETY")
        self.assertEqual((shared["agreement_value"], shared["payment_value"]), (150.0, 30.0))

        with_placeholders = aggregates.award_totals(group_by="recipient", include_placeholders=True)
        self.assertEqual(with_placeholders["data"][0]["group"], NOT_DISCLOSED)

    def test_award_totals_by_fiscal_year(self):
        result = aggregates.award_totals(
            group_by="fiscal_year", filters=[{"field": "organization", "op": "eq", "value": "Government of Canada"}]
        )
        self.assertEqual(result["data"], [
            {"group": 2024, "award_count": 3, "agreement_value": 1170.0, "payment_value": None, "total_value": 1170.0}
        ])

    def test_award_totals_invalid_group_by(self):
        with self.assertRaises(ValueError):
            aggregates.award_totals(group_by="email")

    def test_recipient_funding_by_name_and_variants(self):
        result = aggregates.recipient_funding(recipient_name="Example Society")
        by_org = {r["organization"]: r for r in result["by_organization"]}
        self.assertEqual(by_org["Government of Canada"]["agreement_value"], 150.0)
        self.assertEqual(by_org["Government of Alberta"]["payment_value"], 30.0)
        self.assertEqual([v["name"] for v in result["possible_variants"]], ["EXAMPLE SOCIETY OF CALGARY"])

    def test_recipient_funding_unknown_name_suggests(self):
        with self.assertRaisesMessage(ValueError, "EXAMPLE SOCIETY OF CALGARY"):
            aggregates.recipient_funding(recipient_name="Society of Calgary")

    def test_ministry_funding_reports_placeholders_separately(self):
        result = aggregates.ministry_funding(ministry_id=self.health.id)
        self.assertEqual(result["top_recipients"], [])
        self.assertEqual(result["placeholder_totals"][0]["recipient"], NOT_DISCLOSED)
        self.assertEqual(result["totals"]["payment_value"], 1_000_000.0)

    def test_shared_recipients(self):
        result = aggregates.shared_recipients()
        self.assertEqual(result["recipient_count"], 1)
        row = result["data"][0]
        self.assertEqual(row["recipient"], "EXAMPLE SOCIETY")
        funding = {f["organization"]: f["value"] for f in row["funding"]}
        self.assertEqual(funding, {"Government of Alberta": 30.0, "Government of Canada": 150.0})
        self.assertEqual(aggregates.shared_recipients(min_value_each=50)["recipient_count"], 0)
        self.assertEqual(aggregates.shared_recipients(search="example soc")["recipient_count"], 1)
        self.assertEqual(aggregates.shared_recipients(search="widgets")["recipient_count"], 0)
        with self.assertRaises(ValueError):
            aggregates.shared_recipients(order_by="nonsense")

    # -- flexible query ---------------------------------------------------------
    def test_query_grouped_sum_current_only(self):
        result = flexible.query(
            model="award",
            group_by=["organization", "record_kind"],
            aggregations=[{"func": "sum", "field": "value", "alias": "total"}],
            order_by=["organization"],
        )
        totals = {(r["organization"], r["record_kind"]): r["total"] for r in result["data"]}
        self.assertEqual(totals[("Government of Canada", "agreement")], 1170.0)
        all_versions = flexible.query(
            model="award", current_only=False,
            filters=[{"field": "organization", "op": "eq", "value": "Government of Canada"}],
            aggregations=[{"func": "sum", "field": "value", "alias": "total"}],
        )
        self.assertEqual(all_versions["data"]["total"], 1270.0)

    def test_query_group_by_fiscal_year_has_no_duplicate_groups(self):
        result = flexible.query(
            model="award", group_by=["fiscal_year"],
            aggregations=[{"func": "count", "field": "id", "alias": "n"}], order_by=["fiscal_year"],
        )
        years = [r["fiscal_year"] for r in result["data"]]
        self.assertEqual(len(years), len(set(years)))

    def test_query_plain_rows_omit_description_unless_requested(self):
        rows = flexible.query(model="award", limit=1)["data"]
        self.assertNotIn("description", rows[0])
        self.assertIn("organization", rows[0])
        rows = flexible.query(model="award", fields=["reference", "description"], limit=1)["data"]
        self.assertEqual(set(rows[0]), {"reference", "description"})

    def test_query_grouped_order_by_rejects_non_group_field(self):
        with self.assertRaises(ValueError):
            flexible.query(model="award", group_by=["recipient"],
                           aggregations=[{"func": "sum", "field": "value", "alias": "t"}], order_by=["start_date"])

    # -- security boundary ------------------------------------------------------
    def test_query_rejects_disallowed_models(self):
        for bad in ("user", "oauthclient", "oauthrevokedtoken", "session", "recipientalias"):
            with self.subTest(model=bad), self.assertRaises(ValueError):
                flexible.query(model=bad)

    def test_query_rejects_relation_traversal_outside_allowlist(self):
        with self.assertRaises(ValueError):
            flexible.query(model="award", filters=[{"field": "recipient__awards__ministry__organization__name",
                                                    "op": "eq", "value": "x"}])

    def test_rejects_bad_operator_and_non_numeric_sum_and_bad_alias(self):
        with self.assertRaises(ValueError):
            records.list_awards(filters=[{"field": "value", "op": "DROP", "value": 1}])
        with self.assertRaises(ValueError):
            flexible.query(model="award", aggregations=[{"func": "sum", "field": "description"}])
        with self.assertRaises(ValueError):
            flexible.query(model="award", aggregations=[{"func": "count", "field": "id", "alias": "x; DROP"}])

    def test_allowlist_excludes_accounts_and_oauth(self):
        for name in ("user", "oauthclient", "oauthauthorizationrequest", "oauthrevokedtoken"):
            self.assertNotIn(name, schema.ALLOWED_MODELS)

    def test_describe_schema_lists_conventions(self):
        described = flexible.describe_schema()
        for key in ("fiscal_year", "do_not_mix", "amendments", "placeholders", "attribution"):
            self.assertIn(key, described["conventions"])

    # -- row cap ----------------------------------------------------------------
    @override_settings(MCP_MAX_ROWS=2)
    def test_limit_is_capped(self):
        result = records.list_awards(limit=10_000)
        self.assertEqual((result["limit"], len(result["data"]), result["count"]), (2, 2, 7))
        self.assertEqual(len(flexible.query(model="award", limit=10_000)["data"]), 2)

    @override_settings(MCP_MAX_ROWS=None)
    def test_unlimited_when_none(self):
        result = records.list_awards(limit=10_000)
        self.assertEqual((result["limit"], len(result["data"])), (10_000, 7))


class MCPCachingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        GrantsFixture.build(cls)

    def setUp(self):
        cache.clear()

    def test_aggregate_result_served_from_cache(self):
        first = aggregates.award_totals(group_by="ministry")
        with CaptureQueriesContext(connection) as ctx:
            second = aggregates.award_totals(group_by="ministry")
        self.assertEqual(first, second)
        self.assertEqual(len(ctx.captured_queries), 0)

    def test_bump_version_invalidates(self):
        first = aggregates.award_totals(group_by="organization")
        Award.objects.create(
            ministry=self.culture, recipient=self.shared, record_kind=Award.PAYMENT,
            reference="AB-new", value=1, start_date=date(2024, 9, 1),
        )
        bump_version()
        second = aggregates.award_totals(group_by="organization")
        self.assertNotEqual(first, second)

    def test_positional_and_keyword_calls_share_one_entry(self):
        aggregates.ministry_funding(ministry_id=self.health.id)
        with CaptureQueriesContext(connection) as ctx:
            aggregates.ministry_funding(self.health.id)
        self.assertEqual(len(ctx.captured_queries), 0)

    def test_list_count_cached_across_offsets(self):
        records.list_awards(limit=1, offset=0)
        with CaptureQueriesContext(connection) as ctx:
            records.list_awards(limit=1, offset=1)
        self.assertFalse([q for q in ctx.captured_queries if "COUNT(" in q["sql"].upper()])

    def test_offset_walk_is_disjoint_and_exhaustive(self):
        seen = set()
        for offset in range(7):
            seen.update(r["id"] for r in records.list_awards(limit=1, offset=offset)["data"])
        self.assertEqual(len(seen), 7)
