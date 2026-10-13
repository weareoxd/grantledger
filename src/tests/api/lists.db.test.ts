/**
 * Web API tests against the shared two-government fixture (src/tests/db/helpers.ts).
 *
 * Federal (current): EXAMPLE SOCIETY 150, NATIONAL WIDGETS INC 1,000, withheld individual 20.
 * Alberta: EXAMPLE SOCIETY 40 and -10 (Culture/CFEP), EXAMPLE SOCIETY OF CALGARY 5, RECIPIENT NOT
 * DISCLOSED 1,000,000 (Health/FFS, estimated date). All in FY2024.
 */
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { refreshRollup } from "@/lib/grants/rollup";
import { clearCache } from "@/lib/server/cache";
import { buildGrantsFixture, type GrantsFixture, resetDb } from "@/tests/db/helpers";
import { call, conditions, getJson, withQuery } from "./client";

vi.mock("@/lib/auth/session", () => ({
  userOrUnauthorized: async () => ({ id: "u1", username: "tester", name: "tester", role: "user" }),
}));

let fx: GrantsFixture;
const org = (o: { id: number }, rest = "") => `/api/organization/${o.id}${rest ? `/${rest}` : ""}`;
type Row = Record<string, unknown>;
const data = (body: { data?: Row[] }) => body.data as Row[];

async function addPayment(
  ministryId: number,
  programId: number,
  recipientId: number,
  reference: string,
  value: number,
  startDate: string,
) {
  await getPool().query(
    `INSERT INTO award (ministry_id, program_id, recipient_id, record_kind, reference, value, start_date)
     VALUES ($1, $2, $3, 'payment', $4, $5, $6)`,
    [ministryId, programId, recipientId, reference, value, startDate],
  );
}

beforeEach(async () => {
  await resetDb();
  fx = await buildGrantsFixture();
  await refreshRollup();
  clearCache();
});

describe("aggregated lists", () => {
  it("lists organizations", async () => {
    const body = await getJson("/api/organization");
    expect(new Set(Object.keys(body))).toEqual(
      new Set([
        "count",
        "data",
        "organization",
        "ministry",
        "program",
        "recipient",
        "footer_totals",
      ]),
    );
    const rows = Object.fromEntries(data(body).map((r) => [r.key, r]));
    const fed = rows.federal as Row;
    expect({
      ministry_count: fed.ministry_count,
      recipient_count: fed.recipient_count,
      award_count: fed.award_count,
      award_value: fed.award_value,
    }).toEqual({ ministry_count: 1, recipient_count: 3, award_count: 3, award_value: 1170 });
    expect((rows.alberta as Row).award_value).toBe(1_000_035);
    expect((rows.alberta as Row).measure).toBe("Payments (cash paid)");
    // values are never added across governments
    expect(body.footer_totals).toEqual({ award_count: 7 });
  });

  it("carries organizations' metadata", async () => {
    const rows = Object.fromEntries(
      data(await getJson("/api/organization")).map((r) => [r.key, r]),
    );
    expect((rows.federal as Row).record_kind).toBe("agreement");
    expect((rows.federal as Row).ministry_noun).toBe("Department");
    expect((rows.alberta as Row).ministry_noun).toBe("Ministry");
    expect((rows.federal as Row).fiscal_years).toEqual([2024]);
    expect((rows.alberta as Row).attribution).toContain("Open Government Licence");
    expect((rows.alberta as Row).licence_url).toMatch(/^https:\/\//);
  });

  it("lists an organization's ministries", async () => {
    const body = await getJson(org(fx.ab, "ministry"));
    expect(data(body).map((r) => r.name)).toEqual(["Culture", "Health"]);
    const culture = data(body)[0] as Row;
    expect([
      culture.program_count,
      culture.recipient_count,
      culture.award_count,
      culture.award_value,
    ]).toEqual([1, 2, 3, 35]);
    expect(body.footer_totals).toEqual({ award_count: 4, award_value: 1_000_035 });
    expect([body.organization, body.ministry, body.program, body.recipient]).toEqual([
      "Government of Alberta",
      null,
      null,
      null,
    ]);
  });

  it("lists programs and their recipients", async () => {
    let body = await getJson(org(fx.ab, `ministry/${fx.culture.id}/program`));
    expect(data(body).map((r) => [r.name, r.recipient_count, r.award_value])).toEqual([
      ["CFEP", 2, 35],
    ]);
    body = await getJson(org(fx.ab, `ministry/${fx.culture.id}/program/${fx.abProg.id}/recipient`));
    expect(data(body).map((r) => [r.name, r.award_value])).toEqual([
      ["Example Society", 30],
      ["EXAMPLE SOCIETY OF CALGARY", 5],
    ]);
    expect([body.ministry, body.program]).toEqual(["Culture", "CFEP"]);
  });

  it("lists a ministry's recipients", async () => {
    const body = await getJson(org(fx.ab, `ministry/${fx.culture.id}/recipient`));
    expect(data(body).map((r) => [r.name, r.award_count])).toEqual([
      ["Example Society", 2],
      ["EXAMPLE SOCIETY OF CALGARY", 1],
    ]);
  });

  it("badges placeholders and can hide them", async () => {
    const body = await getJson(org(fx.fed, "recipient"));
    expect(data(body).map((r) => r.key)).toEqual([
      "EXAMPLE SOCIETY",
      WITHHELD_INDIVIDUAL,
      "NATIONAL WIDGETS INC",
    ]);
    expect((data(body)[1] as Row).is_placeholder).toBe(true);
    const hidden = await getJson(org(fx.fed, "recipient"), { hide_placeholders: "true" });
    expect(hidden.count).toBe(2);
    expect((hidden.footer_totals as Row).award_value).toBe(1150);
  });

  it("lists a recipient's ministries", async () => {
    const body = await getJson(org(fx.fed, `recipient/${fx.shared.id}/ministry`));
    expect(data(body).map((r) => [r.name, r.award_value])).toEqual([
      ["Example Agency Canada", 150],
    ]);
    expect(body.recipient).toBe("Example Society"); // as published
  });

  it("scopes to a fiscal year", async () => {
    expect((await getJson(org(fx.ab, "ministry"), { fiscal_year: 2024 })).count).toBe(2);
    const empty = await getJson(org(fx.ab, "ministry"), { fiscal_year: 2023 });
    expect([empty.count, empty.data]).toEqual([0, []]);
    expect(empty.footer_totals).toEqual({ award_count: 0, award_value: 0 });
  });

  it("sorts by an aggregate and walks the pages", async () => {
    const url = org(fx.fed, "recipient");
    const body = await getJson(url, { sort: "award_value", sort_order: "desc" });
    expect((data(body)[0] as Row).key).toBe("NATIONAL WIDGETS INC");
    const seen: unknown[] = [];
    for (const page of [1, 2, 3]) {
      const p = await getJson(url, { sort: "award_value", sort_order: "desc", page_size: 1, page });
      seen.push(...data(p).map((r) => r.id));
    }
    expect(new Set(seen).size).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it("sorts ascending for any order but desc", async () => {
    const body = await getJson(org(fx.fed, "recipient"), { sort: "award_value", sort_order: "up" });
    expect((data(body)[0] as Row).key).toBe(WITHHELD_INDIVIDUAL);
  });

  it("finds one row by id, as overview pages do", async () => {
    const cases: [string, number][] = [
      ["/api/organization", fx.fed.id],
      [org(fx.ab, "ministry"), fx.health.id],
      [org(fx.ab, `ministry/${fx.culture.id}/program`), fx.abProg.id],
      [org(fx.ab, `ministry/${fx.culture.id}/recipient`), fx.variant.id],
      [org(fx.ab, `ministry/${fx.culture.id}/program/${fx.abProg.id}/recipient`), fx.shared.id],
      [org(fx.fed, "recipient"), fx.fedOnly.id],
      [org(fx.fed, `recipient/${fx.shared.id}/ministry`), fx.dept.id],
    ];
    for (const [url, rowId] of cases) {
      const body = await getJson(url, {
        page_size: 1,
        ...conditions("id", [["equals", String(rowId)]]),
      });
      expect(
        data(body).map((r) => r.id),
        url,
      ).toEqual([rowId]);
      expect(body.count).toBe(1);
    }
  });
});

describe("award lists", () => {
  it("shows current awards by default", async () => {
    const body = await getJson(org(fx.fed, "award"));
    expect(body.count).toBe(3);
    expect(body.footer_totals).toEqual({ value: 1170 });
    expect((data(body)[0] as Row).start_date).toBe("2025-02-01"); // newest first
    expect((data(body)[0] as Row).fiscal_year).toBe(2024);
  });

  it("drops the value footer with superseded amendments", async () => {
    const body = await getJson(org(fx.fed, "award"), { include_superseded: "true" });
    expect([body.count, body.footer_totals]).toEqual([4, {}]);
  });

  it("scopes awards", async () => {
    const ab = fx.ab;
    expect((await getJson(org(ab, `ministry/${fx.culture.id}/award`))).count).toBe(3);
    expect(
      (await getJson(org(ab, `ministry/${fx.culture.id}/recipient/${fx.shared.id}/award`))).count,
    ).toBe(2);
    expect(
      (await getJson(org(ab, `ministry/${fx.culture.id}/program/${fx.abProg.id}/award`))).count,
    ).toBe(3);
    const body = await getJson(
      org(ab, `ministry/${fx.culture.id}/program/${fx.abProg.id}/recipient/${fx.variant.id}/award`),
    );
    expect(body.count).toBe(1);
    expect([body.ministry, body.program, body.recipient]).toEqual([
      "Culture",
      "CFEP",
      "EXAMPLE SOCIETY OF CALGARY",
    ]);
    expect((await getJson(org(ab, `recipient/${fx.shared.id}/award`))).count).toBe(2);
  });

  it("hides placeholders and scopes to a fiscal year", async () => {
    const body = await getJson(org(fx.ab, "award"), { hide_placeholders: "1" });
    expect([body.count, (body.footer_totals as Row).value]).toEqual([3, 35]);
    expect((await getJson(org(fx.ab, "award"), { fiscal_year: 2023 })).count).toBe(0);
  });

  it("gives rows link ids and a trimmed description", async () => {
    const row = data(await getJson(org(fx.fed, "award"), { sort: "value" })).at(-1) as Row;
    expect(row.recipient).toBe("National Widgets Inc.");
    expect(row.ministry_id).toBe(fx.dept.id);
    expect((row.description as string).length).toBeLessThan(310);
  });

  it("reads the last pages in reverse in the forward order", async () => {
    // 30 Alberta payments; values tie in pairs to exercise the id tiebreak
    for (let i = 0; i < 26; i++) {
      await addPayment(
        fx.culture.id,
        fx.abProg.id,
        fx.variant.id,
        `AB-extra-${i}`,
        Math.floor(i / 2),
        "2024-06-01",
      );
    }
    await refreshRollup(); // unfiltered award counts come from the rollup, as after an import
    const url = org(fx.ab, "award");
    const expected = data(await getJson(url, { sort: "value", page_size: 50 })).map((r) => r.id);
    const walked: unknown[] = [];
    for (const page of [1, 2, 3]) {
      // page 3 starts at offset 20 > 30 // 2, so it is read in reverse
      walked.push(
        ...data(await getJson(url, { sort: "value", page_size: 10, page })).map((r) => r.id),
      );
    }
    expect(expected).toHaveLength(30);
    expect(walked).toEqual(expected);
  });
});

describe("filters", () => {
  it("matches text, any or all", async () => {
    const url = org(fx.ab, "recipient");
    const one = await getJson(url, conditions("name", [["contains", "calgary"]]));
    expect(data(one).map((r) => r.key)).toEqual(["EXAMPLE SOCIETY OF CALGARY"]);
    const two = await getJson(
      url,
      conditions(
        "name",
        [
          ["contains", "calgary"],
          ["contains", "disclosed"],
        ],
        "or",
      ),
    );
    expect(two.count).toBe(2);
    const both = await getJson(
      url,
      conditions("name", [
        ["contains", "calgary"],
        ["contains", "disclosed"],
      ]),
    );
    expect(both.count).toBe(0);
  });

  it("filters aggregates with HAVING", async () => {
    const body = await getJson(
      org(fx.ab, "recipient"),
      conditions("award_value", [["gte", "1000"]]),
    );
    expect(data(body).map((r) => r.key)).toEqual([NOT_DISCLOSED]);
    expect(body.footer_totals).toEqual({ award_count: 1, award_value: 1_000_000 });
  });

  it("filters awards by type", async () => {
    const url = org(fx.ab, "award");
    expect((await getJson(url, conditions("value", [["lt", "0"]]))).count).toBe(1);
    expect((await getJson(url, conditions("start_date", [["gt", "2024-07-01"]]))).count).toBe(2);
    expect((await getJson(url, conditions("fiscal_year", [["equals", "2024"]]))).count).toBe(4);
    expect((await getJson(url, conditions("lottery_fund", [["equals", "true"]]))).count).toBe(0);
    const fed = org(fx.fed, "award");
    expect((await getJson(fed, conditions("agreement_type", [["equals", "C"]]))).count).toBe(3);
    expect((await getJson(fed, conditions("agreement_type", [["in", "G,O"]]))).count).toBe(0);
    expect((await getJson(fed, conditions("agreement_type", [["in", "C,G"]]))).count).toBe(3);
  });

  it("filters ranges", async () => {
    const url = org(fx.ab, "award");
    expect((await getJson(url, conditions("value", [["between", "-10,5"]]))).count).toBe(2);
    expect(
      (await getJson(url, conditions("start_date", [["between", "2024-04-02,2024-07-02"]]))).count,
    ).toBe(2);
    expect((await getJson(url, conditions("start_date", [["lte", "2024-04-02"]]))).count).toBe(2);
    expect((await getJson(url, conditions("start_date", [["gte", "2024-07-02"]]))).count).toBe(2);
    expect((await getJson(url, conditions("fiscal_year", [["between", "2023,2024"]]))).count).toBe(
      4,
    );
    expect((await getJson(url, conditions("fiscal_year", [["between", "2025,2026"]]))).count).toBe(
      0,
    );
    const recipients = org(fx.ab, "recipient");
    expect((await getJson(recipients, conditions("award_count", [["between", "2,2"]]))).count).toBe(
      1,
    );
  });

  it("combines conditions per column and ANDs columns", async () => {
    const url = org(fx.ab, "award");
    const either = await getJson(
      url,
      conditions(
        "value",
        [
          ["lt", "0"],
          ["gt", "100"],
        ],
        "or",
      ),
    );
    expect(either.count).toBe(2);
    const params = {
      ...conditions(
        "value",
        [
          ["lt", "0"],
          ["gt", "100"],
        ],
        "or",
      ),
      ...conditions("start_date", [["gt", "2024-04-01"]]),
    };
    expect((await getJson(url, params)).count).toBe(1);
  });

  it("matches recipients by normalised name", async () => {
    const body = await getJson(
      org(fx.ab, "award"),
      conditions("recipient", [["equals", "example society"]]),
    );
    expect(body.count).toBe(2);
  });

  it("excludes with notContains", async () => {
    const body = await getJson(
      org(fx.ab, "recipient"),
      conditions("name", [["notContains", "society"]]),
    );
    expect(data(body).map((r) => r.key)).toEqual([NOT_DISCLOSED]);
  });

  it("ignores inert conditions", async () => {
    const url = org(fx.ab, "award");
    const params = {
      "value[0][value]": "",
      "value[0][matchMode]": "gt",
      "value[1][value]": "5",
      "value[operator]": "and",
    };
    expect((await getJson(url, params)).count).toBe(4);
    expect((await getJson(url, { "password[0][value]": "" })).count).toBe(4);
  });

  it("takes thirty conditions but no more", async () => {
    const url = org(fx.ab, "award");
    const thirty: [string, string][] = Array.from({ length: 30 }, (_, n) => [
      "notEquals",
      String(1000 + n),
    ]);
    expect((await getJson(url, conditions("value", thirty))).count).toBe(4);
    const body = await getJson(
      url,
      conditions("value", [...thirty, ["notEquals", "1"]], "and"),
      400,
    );
    expect(Object.keys(body)).toEqual(["value"]);
  });

  it("names the column of an invalid filter", async () => {
    const url = org(fx.ab, "award");
    const cases: [string, Record<string, string>][] = [
      [
        "recipient__awards__ministry__name",
        conditions("recipient__awards__ministry__name", [["equals", "x"]]),
      ],
      ["value", conditions("value", [["contains", "1"]])],
      ["value", conditions("value", [["gt", "abc"]])],
      ["value", conditions("value", [["gt", "1e99999999"]])],
      ["value", conditions("value", [["between", "1"]])],
      ["start_date", conditions("start_date", [["equals", "2024-02-30"]])],
      ["fiscal_year", conditions("fiscal_year", [["equals", "20240"]])],
      ["name", conditions("name", [["contains", "x"]])], // an aggregated list's column
      ["recipient", conditions("recipient", [["contains", "nul\u0000"]])],
      ["recipient", conditions("recipient", [["contains", "x".repeat(201)]])],
      ["agreement_type", conditions("agreement_type", [["equals", "C"]])], // federal-only column
      ["lottery_fund", conditions("lottery_fund", [["equals", "maybe"]])],
      ["sort", { sort: "password" }],
      ["sort", { sort: "description" }], // not sortable
      ["fiscal_year", { fiscal_year: "twenty" }],
      ["include_superseded", { include_superseded: "perhaps" }],
      ["unknown", { unknown: "1" }],
    ];
    for (const [field, params] of cases) {
      const body = await getJson(url, params, 400);
      expect(Object.keys(body), JSON.stringify(params)).toEqual([field]);
      expect(typeof (body[field] as string[])[0]).toBe("string");
    }
    const body = await getJson(
      org(fx.fed, "award"),
      conditions("agreement_type", [["in", "C,X"]]),
      400,
    );
    expect(Object.keys(body)).toEqual(["agreement_type"]);
  });

  it("only takes toggles where they apply", async () => {
    let body = await getJson(org(fx.ab, "ministry"), { include_superseded: "true" }, 400);
    expect(Object.keys(body)).toEqual(["include_superseded"]);
    body = await getJson(org(fx.ab, "ministry"), { hide_placeholders: "true" }, 400);
    expect(Object.keys(body)).toEqual(["hide_placeholders"]);
    await getJson(org(fx.ab, "ministry"), { include_superseded: "false" }); // off is fine anywhere
  });
});

describe("paging", () => {
  it("bounds the page size", async () => {
    const url = org(fx.ab, "award");
    expect(data(await getJson(url, { page_size: 1 }))).toHaveLength(1);
    for (const size of ["0", "-1", "abc"]) {
      expect(data(await getJson(url, { page_size: size }))).toHaveLength(4); // the default, 25
    }
    expect(data(await getJson(url, { page_size: 500 }))).toHaveLength(4); // capped at 100
  });

  it("does not find pages past the end", async () => {
    const url = org(fx.ab, "award");
    expect((await getJson(url, { page: 2, page_size: 2 })).count).toBe(4);
    for (const page of ["3", "0", "abc", "²"]) {
      expect(await getJson(url, { page, page_size: 2 }, 404)).toEqual({ detail: "Invalid page." });
    }
    const empty = await getJson(org(fx.ab, "ministry"), { fiscal_year: 2023, page: 1 });
    expect(empty.count).toBe(0); // page 1 of an empty list is fine
  });
});

describe("scope and routing", () => {
  it("404s scopes that don't exist or nest", async () => {
    const cases: [string, string][] = [
      ["/api/organization/999/ministry", "Organization not found."],
      [org(fx.fed, `ministry/${fx.health.id}/recipient`), "Ministry not found."], // wrong org
      [org(fx.ab, `ministry/${fx.health.id}/program/${fx.abProg.id}/award`), "Program not found."],
      [org(fx.fed, `recipient/${fx.variant.id}/award`), "Recipient not found."], // not funded here
      [
        org(fx.ab, `ministry/${fx.health.id}/recipient/${fx.shared.id}/award`),
        "Recipient not found.",
      ],
    ];
    for (const [url, detail] of cases) {
      expect(await getJson(url, {}, 404), url).toEqual({ detail });
    }
  });

  it("answers unknown paths and methods in JSON", async () => {
    expect((await getJson("/api/organization/abc/ministry", {}, 404)).detail).toContain(
      "No API resource",
    );
    await getJson("/api/nope", {}, 404);
    await getJson("/api/meta", {}, 404);
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const response = await call(method, "/api/organization");
      expect(response.status).toBe(405);
      expect(await response.json()).toHaveProperty("detail");
    }
  });
});

describe("cache", () => {
  let queries: string[] = [];
  beforeEach(() => {
    queries = [];
    const original = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0] as string | { text?: string };
      queries.push(typeof first === "string" ? first : (first?.text ?? ""));
      return (original as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips aggregation on a repeat request", async () => {
    const url = org(fx.ab, "recipient");
    await getJson(url, { sort: "award_value", sort_order: "desc" });
    queries = [];
    await getJson(url, { sort: "award_value", sort_order: "desc" });
    expect(queries.filter((q) => /award_rollup/i.test(q) && /group by/i.test(q))).toEqual([]);
  });

  it("reuses totals across pages and sorts", async () => {
    const url = org(fx.fed, "award");
    await getJson(url, { include_superseded: "true", page_size: 10 });
    queries = [];
    await getJson(url, { include_superseded: "true", page_size: 10, sort: "value" });
    expect(queries.filter((q) => /COUNT\(/i.test(q))).toEqual([]);
  });

  it("is invalidated by a rollup refresh", async () => {
    const url = org(fx.ab, "ministry");
    const before = (await getJson(url)).footer_totals as Row;
    await addPayment(fx.culture.id, fx.abProg.id, fx.shared.id, "AB-new", 100, "2024-09-01");
    await refreshRollup(); // bumps the data version
    expect(((await getJson(url)).footer_totals as Row).award_value).toBe(
      (before.award_value as number) + 100,
    );
  });
});

describe("export", () => {
  async function exportCsv(
    path: string,
    columns: [string, string][],
    params: Record<string, string | number> = {},
    status = 200,
  ) {
    const response = await call("POST", withQuery(path, params), {
      body: JSON.stringify({ columns: columns.map(([id, header]) => ({ id, header })) }),
      headers: { "content-type": "application/json" },
    });
    if (response.status !== status) {
      throw new Error(
        `POST ${path}: expected ${status}, got ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return response;
  }
  const lines = async (response: Response) =>
    (await response.text())
      .replace(/^\ufeff/, "")
      .split(/\r?\n/)
      .filter(Boolean);

  it("writes a BOM, headers and rows", async () => {
    const columns: [string, string][] = [
      ["recipient", "Recipient"],
      ["value", "Amount paid"],
      ["start_date", "Payment date"],
      ["fiscal_year", "Fiscal year"],
      ["lottery_fund", "Lottery fund"],
    ];
    const response = await exportCsv(org(fx.ab, "award"), columns, { sort: "value" });
    // The raw bytes: Response.text() drops a byte-order mark
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = await lines(response);
    expect(rows[0]).toBe("Recipient,Amount paid,Payment date,Fiscal year,Lottery fund");
    expect(rows[1]).toBe("Example Society,-10.00,2024-07-02,FY2024-25,");
    expect(rows).toHaveLength(5);
    expect(response.headers.get("X-Export-Truncated")).toBe("false");
    expect([response.headers.get("X-Total-Count"), response.headers.get("X-Export-Rows")]).toEqual([
      "4",
      "4",
    ]);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("Content-Disposition")).toContain(
      "grantledger-alberta-awards-all-years.csv",
    );
  });

  it("takes filters and sort from the query string and ignores paging", async () => {
    const response = await exportCsv(org(fx.ab, "award"), [["value", "Value"]], {
      sort: "value",
      sort_order: "desc",
      page: 9,
      page_size: 1,
      ...conditions("value", [["lt", "100"]]),
    });
    expect(await lines(response)).toEqual(["Value", "40.00", "5.00", "-10.00"]);
  });

  it("quotes cells and guards against formulas", async () => {
    await getPool().query(`UPDATE award SET title = $1 WHERE reference = 'F2'`, [
      '=HYPERLINK("x"), "quoted"\nnext line',
    ]);
    const response = await exportCsv(
      org(fx.fed, "award"),
      [
        ["reference", "Reference"],
        ["title", "Title"],
        ["agreement_type", "Type"],
      ],
      { sort: "reference" },
    );
    const rows = (await response.text()).replace(/^\ufeff/, "").split("\r\n");
    expect(rows).toContain('F2,"\'=HYPERLINK(""x""), ""quoted""\nnext line",Contribution');
  });

  it("truncates at the cap", async () => {
    vi.stubEnv("API_EXPORT_MAX_ROWS", "2");
    resetEnvCache();
    try {
      const response = await exportCsv(org(fx.ab, "award"), [
        ["recipient", "Recipient"],
        ["value", "Value"],
      ]);
      expect(response.headers.get("X-Export-Truncated")).toBe("true");
      expect([
        response.headers.get("X-Total-Count"),
        response.headers.get("X-Export-Rows"),
      ]).toEqual(["4", "2"]);
      expect(response.headers.get("Content-Disposition")).toContain("-first-rows.csv");
      expect(await lines(response)).toHaveLength(3);
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });

  it("reads rows only as fast as the client takes them", async () => {
    // Enough rows for many 64 KB chunks
    await getPool().query(
      `INSERT INTO award (ministry_id, program_id, recipient_id, record_kind, reference, value, start_date)
       SELECT $1, $2, $3, 'payment', 'bulk-' || n, n, '2024-07-01'
         FROM generate_series(1, 40000) AS n`,
      [fx.health.id, fx.abProg.id, fx.ffs.id],
    );
    const busy = () => getPool().totalCount - getPool().idleCount;
    const response = await exportCsv(org(fx.ab, "award"), [
      ["value", "Value"],
      ["start_date", "Payment date"],
    ]);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    expect((await reader.read()).done).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Still mid-export: its connection waits for the client rather than reading everything
    expect(busy()).toBeGreaterThan(0);
    await reader.cancel();
    await vi.waitFor(() => expect(busy()).toBe(0));
  });

  it("hands its connection back when the client leaves as it starts", async () => {
    const busy = () => getPool().totalCount - getPool().idleCount;
    await vi.waitFor(() => expect(busy()).toBe(0));
    const leaving = new AbortController();
    const response = await call("POST", org(fx.ab, "award"), {
      body: JSON.stringify({ columns: [{ id: "value", header: "Value" }] }),
      headers: { "content-type": "application/json" },
      signal: leaving.signal,
    });
    expect(response.status).toBe(200);
    // Gone while the export is still taking its connection
    leaving.abort();
    await vi.waitFor(() => expect(busy()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(busy()).toBe(0);
  });

  it("exports aggregated lists", async () => {
    const response = await exportCsv(org(fx.ab, "ministry"), [
      ["name", "Ministry"],
      ["award_count", "Payments"],
      ["award_value", "Paid"],
    ]);
    expect(await lines(response)).toEqual([
      "Ministry,Payments,Paid",
      "Culture,3,35.00",
      "Health,1,1000000.00",
    ]);
  });

  it("needs the list's own columns", async () => {
    const url = org(fx.ab, "award");
    const bad: [string, string][][] = [
      [],
      [["password", "x"]],
      [["agreement_type", "Type"]], // a federal column, on Alberta's list
      [
        ["value", "Value"],
        ["value", "Again"],
      ],
      [["value", "x".repeat(201)]],
    ];
    for (const columns of bad) {
      const response = await exportCsv(url, columns, {}, 400);
      expect(Object.keys(await response.json())).toEqual(["columns"]);
    }
    for (const body of [
      '{"columns": "value"}',
      "[]",
      '{"columns": [{"id": 1, "header": "x"}]}',
      "{".repeat(5000) + "}".repeat(5000),
    ]) {
      const response = await call("POST", url, {
        body,
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(400);
    }
  });

  it("reports bad filters and scopes as pages do", async () => {
    const response = await exportCsv(
      org(fx.ab, "award"),
      [["value", "Value"]],
      conditions("value", [["gt", "abc"]]),
      400,
    );
    expect(Object.keys(await response.json())).toEqual(["value"]);
    await exportCsv("/api/organization/999/award", [["value", "Value"]], {}, 404);
  });
});
