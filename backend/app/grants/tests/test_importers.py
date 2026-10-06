"""Importers, exercised on small synthetic files in each real header layout."""

import csv
import os
import shutil
import tempfile
from datetime import date
from decimal import Decimal

from django.test import TestCase

from app.grants.importers.alberta import import_alberta, ministry_title
from app.grants.importers.base import prune_orphans
from app.grants.importers.federal import import_federal
from app.grants.models import Award, FiscalYear, Ministry, Organization, Recipient
from app.grants.normalize import NOT_DISCLOSED, WITHHELD_INDIVIDUAL

FEDERAL_HEADER = (
    "ref_number,amendment_number,amendment_date,agreement_type,recipient_type,"
    "recipient_business_number,recipient_legal_name,recipient_operating_name,"
    "research_organization_name,recipient_country,recipient_province,recipient_city,"
    "recipient_postal_code,federal_riding_name_en,federal_riding_name_fr,"
    "federal_riding_number,prog_name_en,prog_name_fr,prog_purpose_en,prog_purpose_fr,"
    "agreement_title_en,agreement_title_fr,agreement_number,agreement_value,"
    "foreign_currency_type,foreign_currency_value,agreement_start_date,agreement_end_date,"
    "coverage,description_en,description_fr,naics_identifier,expected_results_en,"
    "expected_results_fr,additional_information_en,additional_information_fr,owner_org,"
    "owner_org_title"
).split(",")

ALBERTA_YEARLY_HEADER = [
    "Ministry", "BUName", "Recipient", "Program", "Amount", "Lottery", "PaymentDate",
    "FiscalYear", "DisplayFiscalYear",
]

DEPT = "Example Agency Canada | Agence d'exemple Canada"


def federal_row(**kw):
    row = {k: "" for k in FEDERAL_HEADER}
    row.update(
        ref_number="001-2024-Q1-0001", amendment_number="0", agreement_type="G",
        recipient_type="N", recipient_legal_name="Example Community Association",
        recipient_province="AB", recipient_city="Calgary", prog_name_en="Community Program",
        agreement_title_en="Community project", agreement_value="100000.00",
        agreement_start_date="2024-05-01", agreement_end_date="2026-03-31",
        description_en="Supports a community project.", owner_org="eac-aec",
        owner_org_title=DEPT,
    )
    row.update(kw)
    return row


class ImporterTestCase(TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def write_csv(self, name, header, rows, encoding="utf-8", trailing_comma=False):
        path = os.path.join(self.tmp, name)
        with open(path, "w", newline="", encoding=encoding) as fh:
            writer = csv.writer(fh, quoting=csv.QUOTE_MINIMAL)
            writer.writerow(header + ([""] if trailing_comma else []))
            for row in rows:
                values = [row.get(h, "") for h in header]
                writer.writerow(values + ([""] if trailing_comma else []))
        return path


class FederalImporterTests(ImporterTestCase):
    def test_import_amendments_and_current_flag(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [
            federal_row(),
            federal_row(amendment_number="1", amendment_date="2025-01-15", agreement_value="150000"),
            federal_row(ref_number="001-2024-Q1-0002", recipient_legal_name="EXAMPLE COMMUNITY ASSOCIATION",
                        agreement_value="5000", agreement_start_date="2025-02-01"),
        ])
        stats = import_federal(path)
        self.assertEqual(stats.imported, 3)

        org = Organization.objects.get(key="federal")
        self.assertEqual(org.name, "Government of Canada")
        ministry = Ministry.objects.get(organization=org)
        self.assertEqual(ministry.name, "Example Agency Canada")

        # Both spellings land on one recipient.
        self.assertEqual(Recipient.objects.filter(is_placeholder=False).count(), 1)

        current = Award.objects.filter(is_current=True).order_by("reference")
        self.assertEqual(
            [(a.reference, a.amendment_number, a.value) for a in current],
            [("001-2024-Q1-0001", 1, Decimal("150000.00")), ("001-2024-Q1-0002", 0, Decimal("5000.00"))],
        )
        self.assertFalse(Award.objects.get(reference="001-2024-Q1-0001", amendment_number=0).is_current)
        # Feb 2025 belongs to FY2024
        self.assertEqual(Award.objects.get(reference="001-2024-Q1-0002").fiscal_year, 2024)
        self.assertTrue(FiscalYear.objects.filter(year=2024).exists())

    def test_individuals_are_withheld_but_counted(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [
            federal_row(ref_number="R1", recipient_type="P", recipient_legal_name="Doe, Jane",
                        agreement_title_en="Research by Jane Doe", description_en="Jane's project"),
            federal_row(ref_number="R2", recipient_type="", recipient_legal_name="Roe Richard"),
            federal_row(ref_number="R3", recipient_type="", recipient_legal_name="Example Widgets Inc."),
            federal_row(ref_number="R4", recipient_legal_name=""),
        ])
        stats = import_federal(path)
        self.assertEqual(stats.imported, 4)
        self.assertEqual(stats.withheld_individuals, 2)
        self.assertEqual(stats.not_disclosed, 1)

        withheld = Award.objects.filter(recipient__name=WITHHELD_INDIVIDUAL)
        self.assertEqual(withheld.count(), 2)
        for award in withheld:
            self.assertIsNone(award.title)
            self.assertIsNone(award.description)
            self.assertIsNone(award.recipient_city)
        self.assertTrue(Recipient.objects.get(name=WITHHELD_INDIVIDUAL).is_placeholder)
        self.assertTrue(Recipient.objects.get(name=NOT_DISCLOSED).is_placeholder)
        self.assertFalse(Recipient.objects.filter(display_name__icontains="Doe").exists())
        self.assertFalse(Recipient.objects.filter(display_name__icontains="Roe").exists())
        self.assertTrue(Recipient.objects.filter(name="EXAMPLE WIDGETS INC").exists())

    def test_people_under_other_types_are_withheld_institutions_are_not(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [
            federal_row(ref_number="T1", recipient_type="F", recipient_legal_name="Jane Doe, John Doe"),
            federal_row(ref_number="T2", recipient_type="F", recipient_legal_name="Doe Cattle Company"),
            federal_row(ref_number="T3", recipient_type="G", recipient_legal_name="Ville de Exemple"),
            federal_row(ref_number="T4", recipient_type="G", recipient_legal_name="Jane Doe"),
        ])
        stats = import_federal(path)
        self.assertEqual(stats.withheld_individuals, 1)
        kept = set(Recipient.objects.filter(is_placeholder=False).values_list("name", flat=True))
        self.assertEqual(kept, {"DOE CATTLE COMPANY", "VILLE DE EXEMPLE", "JANE DOE"})

    def test_rows_without_start_date_are_skipped(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row(agreement_start_date="")])
        stats = import_federal(path)
        self.assertEqual((stats.imported, stats.skipped), (0, 1))

    def test_prune_orphan_recipients(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row(recipient_legal_name="Old Name Society")])
        import_federal(path)
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row(recipient_legal_name="New Name Society")])
        import_federal(path)
        self.assertEqual(prune_orphans(), {"recipients": 1, "programs": 0, "ministries": 0})
        self.assertEqual(list(Recipient.objects.values_list("name", flat=True)), ["NEW NAME SOCIETY"])

    def test_reimport_replaces_rows_from_the_same_file(self):
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row(), federal_row(ref_number="R9")])
        import_federal(path)
        path = self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row()])
        stats = import_federal(path)
        self.assertEqual(stats.replaced, 2)
        self.assertEqual(Award.objects.count(), 1)


class AlbertaImporterTests(ImporterTestCase):
    def yearly_rows(self):
        return [
            {"Ministry": "SENIORS, COMMUNITY AND SOCIAL SERVICES", "BUName": "SCSS",
             "Recipient": "EXAMPLE COMMUNITY ASSOCIATION", "Program": "FCSS", "Amount": "2500.000",
             "Lottery": "False", "PaymentDate": "2024-04-02", "FiscalYear": "2024",
             "DisplayFiscalYear": "2024 - 2025"},
            {"Ministry": "SENIORS, COMMUNITY AND SOCIAL SERVICES", "BUName": "SCSS",
             "Recipient": "EXAMPLE COMMUNITY ASSOCIATION", "Program": "FCSS", "Amount": "-500.000",
             "Lottery": "TRUE", "PaymentDate": "2025-03-30", "FiscalYear": "2024",
             "DisplayFiscalYear": "2024 - 2025"},
            {"Ministry": "HEALTH", "BUName": "HEALTH", "Recipient": "", "Program": "FEE FOR SERVICE",
             "Amount": "1000000000", "Lottery": "", "PaymentDate": "", "FiscalYear": "2024",
             "DisplayFiscalYear": "2024 - 2025"},
            {"Ministry": "ADVANCED EDUCATION", "BUName": "SCHOLARSHIPS", "Recipient": "DOE JANE MARIE",
             "Program": "EXAMPLE SCHOLARSHIP", "Amount": "1000", "Lottery": "", "PaymentDate": "2024-09-01",
             "FiscalYear": "2024", "DisplayFiscalYear": "2024 - 2025"},
        ]

    def test_yearly_layout(self):
        path = self.write_csv("tbf-grants-disclosure-2024-25.csv", ALBERTA_YEARLY_HEADER, self.yearly_rows())
        stats = import_alberta(path)
        self.assertEqual(stats.imported, 4)
        self.assertEqual(stats.not_disclosed, 1)
        self.assertEqual(stats.withheld_individuals, 1)
        self.assertEqual(stats.estimated_dates, 1)

        self.assertEqual(Organization.objects.get(key="alberta").name, "Government of Alberta")
        self.assertTrue(Ministry.objects.filter(name="Seniors, Community and Social Services").exists())

        aggregate = Award.objects.get(recipient__name=NOT_DISCLOSED)
        self.assertEqual(aggregate.start_date, date(2024, 4, 1))
        self.assertTrue(aggregate.start_date_estimated)
        self.assertEqual(aggregate.record_kind, Award.PAYMENT)

        reversal = Award.objects.get(value=Decimal("-500.00"))
        self.assertTrue(reversal.lottery_fund)
        self.assertEqual(reversal.fiscal_year, 2024)
        self.assertFalse(Recipient.objects.filter(display_name__icontains="DOE").exists())
        self.assertTrue(all(a.is_current for a in Award.objects.all()))

    def test_current_export_layout_with_trailing_comma(self):
        header = ["Ministry", "BUName", "Recipient", "Program", "Amount", "PaymentDate",
                  "DisplayFiscalYear", "LotteryFund"]
        rows = [{"Ministry": "ADVANCED EDUCATION", "BUName": "ADVANCED EDUCATION",
                 "Recipient": "EXAMPLE UNIVERSITY", "Program": "PSI OPER & PROG SUPPORT",
                 "Amount": "1036000.000", "PaymentDate": "4/2/2026 12:00:00 AM",
                 "DisplayFiscalYear": "2026 - 2027", "LotteryFund": ""}]
        path = self.write_csv("tbf-grants-disclosure-2026-27.csv", header, rows, trailing_comma=True)
        stats = import_alberta(path)
        self.assertEqual(stats.imported, 1)
        award = Award.objects.get()
        self.assertEqual(award.start_date, date(2026, 4, 2))
        self.assertEqual(award.value, Decimal("1036000.00"))
        self.assertIsNone(award.lottery_fund)
        self.assertEqual(award.reference, "AB-2026-0000001")

    def test_windows_1252_file(self):
        rows = [dict(self.yearly_rows()[0], Recipient="SOCIÉTÉ EXEMPLE ASSOCIATION")]
        path = self.write_csv("tbf-grants-disclosure-2024-25.csv", ALBERTA_YEARLY_HEADER, rows, encoding="cp1252")
        import_alberta(path)
        recipient = Recipient.objects.get(is_placeholder=False)
        self.assertEqual(recipient.name, "SOCIETE EXEMPLE ASSOCIATION")
        self.assertEqual(recipient.display_name, "SOCIÉTÉ EXEMPLE ASSOCIATION")

    def test_cross_source_recipient_is_shared(self):
        import_alberta(self.write_csv("tbf-grants-disclosure-2024-25.csv", ALBERTA_YEARLY_HEADER, self.yearly_rows()))
        import_federal(self.write_csv("grants.csv", FEDERAL_HEADER, [federal_row()]))
        recipient = Recipient.objects.get(name="EXAMPLE COMMUNITY ASSOCIATION")
        orgs = set(recipient.awards.values_list("ministry__organization__key", flat=True))
        self.assertEqual(orgs, {"federal", "alberta"})

    def test_misaligned_rows_are_rejected_not_shifted(self):
        path = os.path.join(self.tmp, "tbf-grants-disclosure-2019-20.csv")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(",".join(ALBERTA_YEARLY_HEADER) + "\n")
            # Unquoted commas inside the ministry and business-unit names.
            fh.write("CULTURE, MULTICULTURALISM AND STATUS OF WOMEN,MULTICUL,STATUSOFWOMEN,"
                     "EXAMPLE PUBLISHING INC,CULTURAL INDUSTRIES,8500.000,False,2019-05-03,2019,2019 - 2020\n")
            fh.write("CULTURE,CULTURE,EXAMPLE PUBLISHING INC,CULTURAL INDUSTRIES,100.000,False,"
                     "2019-05-03,2019,2019 - 2020\n")
            fh.write("CULTURE,CULTURE,EXAMPLE PUBLISHING INC\n")  # too few fields
        stats = import_alberta(path)
        self.assertEqual((stats.read, stats.imported, stats.malformed), (3, 1, 2))
        self.assertEqual(Award.objects.get().value, Decimal("100.00"))

    def test_ministry_title(self):
        self.assertEqual(ministry_title("CHILDREN'S SERVICES"), "Children's Services")
        self.assertEqual(ministry_title("ARTS, CULTURE AND STATUS OF WOMEN"), "Arts, Culture and Status of Women")
        self.assertEqual(
            ministry_title("CULTURE,MULTICULTURALISMANDSTATUSOFWOMEN"),
            "Culture, Multiculturalism and Status of Women",
        )

    def test_wrapping_quotes_are_stripped(self):
        rows = [dict(self.yearly_rows()[0], Ministry='"CULTURE, MULTICULTURALISM AND STATUS OF WOMEN"')]
        import_alberta(self.write_csv("tbf-grants-disclosure-2019-20.csv", ALBERTA_YEARLY_HEADER, rows))
        self.assertEqual(Ministry.objects.get().name, "Culture, Multiculturalism and Status of Women")
