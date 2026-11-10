// Importers, exercised on small synthetic files in each real header layout.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { importAlberta, ministryTitle } from "@/lib/grants/importers/alberta";
import { importFederal } from "@/lib/grants/importers/federal";
import { pruneOrphans } from "@/lib/grants/importers/maintenance";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { resetDb } from "@/tests/db/helpers";

const FEDERAL_HEADER = (
  "ref_number,amendment_number,amendment_date,agreement_type,recipient_type," +
  "recipient_business_number,recipient_legal_name,recipient_operating_name," +
  "research_organization_name,recipient_country,recipient_province,recipient_city," +
  "recipient_postal_code,federal_riding_name_en,federal_riding_name_fr," +
  "federal_riding_number,prog_name_en,prog_name_fr,prog_purpose_en,prog_purpose_fr," +
  "agreement_title_en,agreement_title_fr,agreement_number,agreement_value," +
  "foreign_currency_type,foreign_currency_value,agreement_start_date,agreement_end_date," +
  "coverage,description_en,description_fr,naics_identifier,expected_results_en," +
  "expected_results_fr,additional_information_en,additional_information_fr,owner_org," +
  "owner_org_title"
).split(",");

const ALBERTA_YEARLY_HEADER = [
  "Ministry",
  "BUName",
  "Recipient",
  "Program",
  "Amount",
  "Lottery",
  "PaymentDate",
  "FiscalYear",
  "DisplayFiscalYear",
];

const DEPT = "Example Agency Canada | Agence d'exemple Canada";

type Row = Record<string, string>;

function federalRow(overrides: Row = {}): Row {
  return {
    ...Object.fromEntries(FEDERAL_HEADER.map((h) => [h, ""])),
    ref_number: "001-2024-Q1-0001",
    amendment_number: "0",
    agreement_type: "G",
    recipient_type: "N",
    recipient_legal_name: "Example Community Association",
    recipient_province: "AB",
    recipient_city: "Calgary",
    prog_name_en: "Community Program",
    agreement_title_en: "Community project",
    agreement_value: "100000.00",
    agreement_start_date: "2024-05-01",
    agreement_end_date: "2026-03-31",
    description_en: "Supports a community project.",
    owner_org: "eac-aec",
    owner_org_title: DEPT,
    ...overrides,
  };
}

/** Python csv.writer's QUOTE_MINIMAL with its "\r\n" line terminator. */
function csvLine(values: string[]) {
  return `${values
    .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
    .join(",")}\r\n`;
}

let tmp: string;

function writeCsv(
  name: string,
  header: string[],
  rows: Row[],
  { encoding = "utf-8", trailingComma = false } = {},
) {
  const extra = trailingComma ? [""] : [];
  const text =
    csvLine([...header, ...extra]) +
    rows.map((row) => csvLine([...header.map((h) => row[h] ?? ""), ...extra])).join("");
  const path = join(tmp, name);
  writeFileSync(path, encoding === "cp1252" ? iconv.encode(text, "win1252") : text);
  return path;
}

async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  return (await getPool().query(text, params)).rows as T[];
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "grants-import-"));
  await resetDb();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("federal importer", () => {
  it("imports amendments and flags the current one", async () => {
    const path = writeCsv("grants.csv", FEDERAL_HEADER, [
      federalRow(),
      federalRow({
        amendment_number: "1",
        amendment_date: "2025-01-15",
        agreement_value: "150000",
      }),
      federalRow({
        ref_number: "001-2024-Q1-0002",
        recipient_legal_name: "EXAMPLE COMMUNITY ASSOCIATION",
        agreement_value: "5000",
        agreement_start_date: "2025-02-01",
      }),
    ]);
    const stats = await importFederal(path);
    expect(stats.imported).toBe(3);

    const [org] = await query<{ name: string }>(
      "SELECT name FROM organization WHERE key = 'federal'",
    );
    expect(org?.name).toBe("Government of Canada");
    expect(await query("SELECT name FROM ministry")).toEqual([{ name: "Example Agency Canada" }]);
    // Both spellings land on one recipient.
    expect(
      await query("SELECT COUNT(*)::int AS n FROM recipient WHERE NOT is_placeholder"),
    ).toEqual([{ n: 1 }]);
    expect(
      await query(
        "SELECT reference, amendment_number, value FROM award WHERE is_current ORDER BY reference",
      ),
    ).toEqual([
      { reference: "001-2024-Q1-0001", amendment_number: 1, value: "150000.00" },
      { reference: "001-2024-Q1-0002", amendment_number: 0, value: "5000.00" },
    ]);
    expect(
      await query(
        "SELECT is_current FROM award WHERE reference = '001-2024-Q1-0001' AND amendment_number = 0",
      ),
    ).toEqual([{ is_current: false }]);
    // Feb 2025 belongs to FY2024
    expect(await query("SELECT year FROM fiscal_year")).toEqual([{ year: 2024 }]);
  });

  it("counts amendments filed under new references once", async () => {
    // One agreement, re-filed with a new reference for each amendment (as ISC does).
    const path = writeCsv("grants.csv", FEDERAL_HEADER, [
      federalRow({
        ref_number: "1910-Q1-1",
        agreement_number: "2122-AB-1",
        amendment_number: "0",
        agreement_value: "100",
      }),
      federalRow({
        ref_number: "1910-Q2-7",
        agreement_number: "2122-AB-1",
        amendment_number: "3",
        amendment_date: "2023-01-10",
        agreement_value: "900",
      }),
      // A program code reused across recipients is not one agreement...
      federalRow({
        ref_number: "N-1",
        agreement_number: "RGPIN",
        recipient_legal_name: "Example University",
      }),
      federalRow({
        ref_number: "N-2",
        agreement_number: "RGPIN",
        recipient_legal_name: "Other College",
      }),
      // ...nor are a recipient's yearly grants under the same code.
      federalRow({
        ref_number: "N-3",
        agreement_number: "RGPIN",
        recipient_legal_name: "Example University",
        agreement_start_date: "2025-05-01",
      }),
    ]);
    await importFederal(path);
    expect(await query("SELECT COUNT(*)::int AS n FROM award WHERE is_current")).toEqual([
      { n: 4 },
    ]);
    expect(
      await query(
        "SELECT reference, value FROM award WHERE is_current AND agreement_number = '2122-AB-1'",
      ),
    ).toEqual([{ reference: "1910-Q2-7", value: "900.00" }]);
    expect(
      await query(
        "SELECT COUNT(*)::int AS n FROM award WHERE is_current AND agreement_number = 'RGPIN'",
      ),
    ).toEqual([{ n: 3 }]);
    const keys = await query<{ agreement_key: string | null }>("SELECT agreement_key FROM award");
    expect(keys.every((row) => row.agreement_key)).toBe(true);
    expect(keys.map((row) => row.agreement_key).join("")).not.toContain("EXAMPLE");
  });

  it("withholds individuals but counts them", async () => {
    const path = writeCsv("grants.csv", FEDERAL_HEADER, [
      federalRow({
        ref_number: "R1",
        recipient_type: "P",
        recipient_legal_name: "Doe, Jane",
        agreement_title_en: "Research by Jane Doe",
        description_en: "Jane's project",
      }),
      federalRow({ ref_number: "R2", recipient_type: "", recipient_legal_name: "Roe Richard" }),
      federalRow({
        ref_number: "R3",
        recipient_type: "",
        recipient_legal_name: "Example Widgets Inc.",
      }),
      federalRow({ ref_number: "R4", recipient_legal_name: "" }),
    ]);
    const stats = await importFederal(path);
    expect(stats.imported).toBe(4);
    expect(stats.withheld_individuals).toBe(2);
    expect(stats.not_disclosed).toBe(1);

    const withheld = await query(
      `SELECT a.title, a.description, a.recipient_city FROM award a
         JOIN recipient r ON r.id = a.recipient_id WHERE r.name = $1`,
      [WITHHELD_INDIVIDUAL],
    );
    expect(withheld).toHaveLength(2);
    for (const row of withheld) {
      expect(row).toEqual({ title: null, description: null, recipient_city: null });
    }
    expect(
      await query("SELECT name, is_placeholder FROM recipient WHERE is_placeholder ORDER BY name"),
    ).toEqual([
      { name: WITHHELD_INDIVIDUAL, is_placeholder: true },
      { name: NOT_DISCLOSED, is_placeholder: true },
    ]);
    expect(
      await query(
        "SELECT 1 FROM recipient WHERE display_name ILIKE '%doe%' OR display_name ILIKE '%roe%'",
      ),
    ).toEqual([]);
    expect(
      await query("SELECT name FROM recipient WHERE name = 'EXAMPLE WIDGETS INC'"),
    ).toHaveLength(1);
  });

  it("withholds people under other types, not institutions", async () => {
    const path = writeCsv("grants.csv", FEDERAL_HEADER, [
      federalRow({
        ref_number: "T1",
        recipient_type: "F",
        recipient_legal_name: "Jane Doe, John Doe",
      }),
      federalRow({
        ref_number: "T2",
        recipient_type: "F",
        recipient_legal_name: "Doe Cattle Company",
      }),
      federalRow({
        ref_number: "T3",
        recipient_type: "G",
        recipient_legal_name: "Ville de Exemple",
      }),
      federalRow({ ref_number: "T4", recipient_type: "G", recipient_legal_name: "Jane Doe" }),
    ]);
    const stats = await importFederal(path);
    expect(stats.withheld_individuals).toBe(1);
    const kept = await query<{ name: string }>(
      "SELECT name FROM recipient WHERE NOT is_placeholder ORDER BY name",
    );
    expect(kept.map((r) => r.name)).toEqual(["DOE CATTLE COMPANY", "JANE DOE", "VILLE DE EXEMPLE"]);
  });

  it("keeps the English half of bilingual names", async () => {
    const path = writeCsv("grants.csv", FEDERAL_HEADER, [
      federalRow({
        ref_number: "B1",
        recipient_legal_name: "Example Steel Limited|Example Steel Limited",
      }),
      federalRow({
        ref_number: "B2",
        recipient_legal_name: "Example Institute | Institut d'exemple",
      }),
    ]);
    await importFederal(path);
    const names = await query<{ display_name: string }>(
      "SELECT display_name FROM recipient WHERE NOT is_placeholder ORDER BY display_name",
    );
    expect(names.map((r) => r.display_name)).toEqual([
      "Example Institute",
      "Example Steel Limited",
    ]);
  });

  it("skips rows without a start date", async () => {
    const stats = await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [federalRow({ agreement_start_date: "" })]),
    );
    expect([stats.imported, stats.skipped]).toEqual([0, 1]);
  });

  it("treats spreadsheet zero dates as missing", async () => {
    const stats = await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [
        federalRow({ ref_number: "Z1", agreement_start_date: "1899-12-30" }),
        federalRow({ ref_number: "Z2", agreement_start_date: "1900-01-01" }),
        federalRow({ ref_number: "Z3", agreement_end_date: "1899-12-31" }),
      ]),
    );
    expect([stats.imported, stats.skipped]).toEqual([1, 2]);
    expect(await query("SELECT end_date FROM award WHERE reference = 'Z3'")).toEqual([
      { end_date: null },
    ]);
  });

  it("makes the fiscal years match the data span", async () => {
    await getPool().query(
      "INSERT INTO fiscal_year (year, start_date, end_date) VALUES (1000, '1000-04-01', '1001-03-31')",
    );
    await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [
        federalRow({ ref_number: "Y1", agreement_start_date: "2022-06-01" }),
        federalRow({ ref_number: "Y2", agreement_start_date: "2024-02-01" }),
      ]),
    );
    expect(await query("SELECT year FROM fiscal_year ORDER BY year")).toEqual([
      { year: 2022 },
      { year: 2023 },
    ]);
  });

  it("prunes orphan recipients", async () => {
    await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [
        federalRow({ recipient_legal_name: "Old Name Society" }),
      ]),
    );
    await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [
        federalRow({ recipient_legal_name: "New Name Society" }),
      ]),
    );
    expect(await pruneOrphans()).toEqual({ recipients: 1, programs: 0, ministries: 0 });
    expect(await query("SELECT name FROM recipient")).toEqual([{ name: "NEW NAME SOCIETY" }]);
  });

  it("replaces rows from the same file on re-import", async () => {
    await importFederal(
      writeCsv("grants.csv", FEDERAL_HEADER, [federalRow(), federalRow({ ref_number: "R9" })]),
    );
    const stats = await importFederal(writeCsv("grants.csv", FEDERAL_HEADER, [federalRow()]));
    expect(stats.replaced).toBe(2);
    expect(await query("SELECT COUNT(*)::int AS n FROM award")).toEqual([{ n: 1 }]);
  });
});

describe("Alberta importer", () => {
  const yearlyRows = (): Row[] => [
    {
      Ministry: "SENIORS, COMMUNITY AND SOCIAL SERVICES",
      BUName: "SCSS",
      Recipient: "EXAMPLE COMMUNITY ASSOCIATION",
      Program: "FCSS",
      Amount: "2500.000",
      Lottery: "False",
      PaymentDate: "2024-04-02",
      FiscalYear: "2024",
      DisplayFiscalYear: "2024 - 2025",
    },
    {
      Ministry: "SENIORS, COMMUNITY AND SOCIAL SERVICES",
      BUName: "SCSS",
      Recipient: "EXAMPLE COMMUNITY ASSOCIATION",
      Program: "FCSS",
      Amount: "-500.000",
      Lottery: "TRUE",
      PaymentDate: "2025-03-30",
      FiscalYear: "2024",
      DisplayFiscalYear: "2024 - 2025",
    },
    {
      Ministry: "HEALTH",
      BUName: "HEALTH",
      Recipient: "",
      Program: "FEE FOR SERVICE",
      Amount: "1000000000",
      Lottery: "",
      PaymentDate: "",
      FiscalYear: "2024",
      DisplayFiscalYear: "2024 - 2025",
    },
    {
      Ministry: "ADVANCED EDUCATION",
      BUName: "SCHOLARSHIPS",
      Recipient: "DOE JANE MARIE",
      Program: "EXAMPLE SCHOLARSHIP",
      Amount: "1000",
      Lottery: "",
      PaymentDate: "2024-09-01",
      FiscalYear: "2024",
      DisplayFiscalYear: "2024 - 2025",
    },
  ];

  it("reads the yearly layout", async () => {
    const stats = await importAlberta(
      writeCsv("tbf-grants-disclosure-2024-25.csv", ALBERTA_YEARLY_HEADER, yearlyRows()),
    );
    expect(stats.imported).toBe(4);
    expect(stats.not_disclosed).toBe(1);
    expect(stats.withheld_individuals).toBe(1);
    expect(stats.estimated_dates).toBe(1);
    expect(await query("SELECT name FROM organization WHERE key = 'alberta'")).toEqual([
      { name: "Government of Alberta" },
    ]);
    expect(
      await query("SELECT 1 FROM ministry WHERE name = 'Seniors, Community and Social Services'"),
    ).toHaveLength(1);
    expect(
      await query(
        `SELECT a.start_date, a.start_date_estimated, a.record_kind FROM award a
           JOIN recipient r ON r.id = a.recipient_id WHERE r.name = $1`,
        [NOT_DISCLOSED],
      ),
    ).toEqual([{ start_date: "2024-04-01", start_date_estimated: true, record_kind: "payment" }]);
    expect(await query("SELECT lottery_fund, start_date FROM award WHERE value = -500")).toEqual([
      { lottery_fund: true, start_date: "2025-03-30" },
    ]);
    expect(await query("SELECT 1 FROM recipient WHERE display_name ILIKE '%doe%'")).toEqual([]);
    expect(await query("SELECT 1 FROM award WHERE NOT is_current")).toEqual([]);
  });

  it("reads the live export layout with its trailing comma", async () => {
    const header = [
      "Ministry",
      "BUName",
      "Recipient",
      "Program",
      "Amount",
      "PaymentDate",
      "DisplayFiscalYear",
      "LotteryFund",
    ];
    const stats = await importAlberta(
      writeCsv(
        "tbf-grants-disclosure-2026-27.csv",
        header,
        [
          {
            Ministry: "ADVANCED EDUCATION",
            BUName: "ADVANCED EDUCATION",
            Recipient: "EXAMPLE UNIVERSITY",
            Program: "PSI OPER & PROG SUPPORT",
            Amount: "1036000.000",
            PaymentDate: "4/2/2026 12:00:00 AM",
            DisplayFiscalYear: "2026 - 2027",
            LotteryFund: "",
          },
        ],
        { trailingComma: true },
      ),
    );
    expect(stats.imported).toBe(1);
    expect(await query("SELECT start_date, value, lottery_fund, reference FROM award")).toEqual([
      {
        start_date: "2026-04-02",
        value: "1036000.00",
        lottery_fund: null,
        reference: "AB-2026-0000001",
      },
    ]);
  });

  it("reads a Windows-1252 file", async () => {
    await importAlberta(
      writeCsv(
        "tbf-grants-disclosure-2024-25.csv",
        ALBERTA_YEARLY_HEADER,
        [{ ...(yearlyRows()[0] as Row), Recipient: "SOCIÉTÉ EXEMPLE ASSOCIATION" }],
        { encoding: "cp1252" },
      ),
    );
    expect(
      await query("SELECT name, display_name FROM recipient WHERE NOT is_placeholder"),
    ).toEqual([
      { name: "SOCIETE EXEMPLE ASSOCIATION", display_name: "SOCIÉTÉ EXEMPLE ASSOCIATION" },
    ]);
  });

  it("shares a recipient across sources", async () => {
    await importAlberta(
      writeCsv("tbf-grants-disclosure-2024-25.csv", ALBERTA_YEARLY_HEADER, yearlyRows()),
    );
    await importFederal(writeCsv("grants.csv", FEDERAL_HEADER, [federalRow()]));
    const orgs = await query<{ key: string }>(
      `SELECT DISTINCT o.key FROM award a JOIN recipient r ON r.id = a.recipient_id
         JOIN ministry m ON m.id = a.ministry_id JOIN organization o ON o.id = m.organization_id
        WHERE r.name = 'EXAMPLE COMMUNITY ASSOCIATION' ORDER BY o.key`,
    );
    expect(orgs.map((r) => r.key)).toEqual(["alberta", "federal"]);
  });

  it("rejects misaligned rows instead of shifting them", async () => {
    const path = join(tmp, "tbf-grants-disclosure-2019-20.csv");
    writeFileSync(
      path,
      `${ALBERTA_YEARLY_HEADER.join(",")}\n` +
        // Unquoted commas inside the ministry and business-unit names.
        "CULTURE, MULTICULTURALISM AND STATUS OF WOMEN,MULTICUL,STATUSOFWOMEN," +
        "EXAMPLE PUBLISHING INC,CULTURAL INDUSTRIES,8500.000,False,2019-05-03,2019,2019 - 2020\n" +
        "CULTURE,CULTURE,EXAMPLE PUBLISHING INC,CULTURAL INDUSTRIES,100.000,False," +
        "2019-05-03,2019,2019 - 2020\n" +
        "CULTURE,CULTURE,EXAMPLE PUBLISHING INC\n", // too few fields
    );
    const stats = await importAlberta(path);
    expect([stats.read, stats.imported, stats.malformed]).toEqual([3, 1, 2]);
    expect(await query("SELECT value FROM award")).toEqual([{ value: "100.00" }]);
  });

  it("title-cases ministry names", () => {
    expect(ministryTitle("CHILDREN'S SERVICES")).toBe("Children's Services");
    expect(ministryTitle("ARTS, CULTURE AND STATUS OF WOMEN")).toBe(
      "Arts, Culture and Status of Women",
    );
    expect(ministryTitle("CULTURE,MULTICULTURALISMANDSTATUSOFWOMEN")).toBe(
      "Culture, Multiculturalism and Status of Women",
    );
  });

  it("strips wrapping quotes", async () => {
    await importAlberta(
      writeCsv("tbf-grants-disclosure-2019-20.csv", ALBERTA_YEARLY_HEADER, [
        {
          ...(yearlyRows()[0] as Row),
          Ministry: '"CULTURE, MULTICULTURALISM AND STATUS OF WOMEN"',
        },
      ]),
    );
    expect(await query("SELECT name FROM ministry")).toEqual([
      { name: "Culture, Multiculturalism and Status of Women" },
    ]);
  });
});
