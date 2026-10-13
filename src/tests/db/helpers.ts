/**
 * Database helpers for the *.db.test.ts files: emptying the test database and the small
 * two-government fixture the importer, rollup, API and MCP tests share.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { award, fiscalYear, ministry, organization, program, recipient } from "@/lib/db/schema";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { clearCache } from "@/lib/server/cache";

const TABLES = [
  "award_rollup",
  "award",
  "recipient_alias",
  "recipient",
  "program",
  "ministry",
  "organization",
  "fiscal_year",
  "import_run",
  "worker_status",
  "app_setting",
  "oauth_authorization_request",
  "oauth_client",
  "oauth_revoked_token",
  "mcp_user",
  '"session"',
  '"account"',
  '"verification"',
  '"user"',
];

/** Empty every app table (and the result cache) so each test starts from nothing. */
export async function resetDb() {
  await getDb().execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`));
  clearCache();
}

export interface GrantsFixture {
  fed: { id: number };
  ab: { id: number };
  dept: { id: number };
  health: { id: number };
  culture: { id: number };
  fedProg: { id: number };
  abProg: { id: number };
  ffs: { id: number };
  shared: { id: number };
  fedOnly: { id: number };
  variant: { id: number };
  withheld: { id: number };
  undisclosed: { id: number };
}

/**
 * Government of Canada: one department, one program, an agreement amended once (100 -> 150), a
 * second agreement (1,000, Feb 2025 so FY2024) and one for an individual (20).
 * Government of Alberta: two ministries; payments to a recipient shared with the federal side
 * (40, then a -10 reversal), to a variant spelling (5), and an undisclosed aggregate (1,000,000,
 * estimated date).
 */
export async function buildGrantsFixture(): Promise<GrantsFixture> {
  const db = getDb();
  const one = async <T>(rows: Promise<T[]>) => (await rows)[0] as T;
  const id = { id: organization.id };

  const fed = await one(
    db.insert(organization).values({ key: "federal", name: "Government of Canada" }).returning(id),
  );
  const ab = await one(
    db.insert(organization).values({ key: "alberta", name: "Government of Alberta" }).returning(id),
  );
  const mid = { id: ministry.id };
  const dept = await one(
    db
      .insert(ministry)
      .values({ organizationId: fed.id, name: "Example Agency Canada" })
      .returning(mid),
  );
  const health = await one(
    db.insert(ministry).values({ organizationId: ab.id, name: "Health" }).returning(mid),
  );
  const culture = await one(
    db.insert(ministry).values({ organizationId: ab.id, name: "Culture" }).returning(mid),
  );
  const pid = { id: program.id };
  const fedProg = await one(
    db.insert(program).values({ ministryId: dept.id, name: "Community Program" }).returning(pid),
  );
  const abProg = await one(
    db.insert(program).values({ ministryId: culture.id, name: "CFEP" }).returning(pid),
  );
  const ffs = await one(
    db.insert(program).values({ ministryId: health.id, name: "FEE FOR SERVICE" }).returning(pid),
  );
  const rid = { id: recipient.id };
  const person = (name: string, displayName: string, isPlaceholder = false) =>
    one(db.insert(recipient).values({ name, displayName, isPlaceholder }).returning(rid));
  const shared = await person("EXAMPLE SOCIETY", "Example Society");
  const fedOnly = await person("NATIONAL WIDGETS INC", "National Widgets Inc.");
  const variant = await person("EXAMPLE SOCIETY OF CALGARY", "EXAMPLE SOCIETY OF CALGARY");
  const withheld = await person(WITHHELD_INDIVIDUAL, WITHHELD_INDIVIDUAL, true);
  const undisclosed = await person(NOT_DISCLOSED, NOT_DISCLOSED, true);

  const agreement = (
    reference: string,
    amendmentNumber: number,
    value: number,
    startDate: string,
    recipientId: number,
    isCurrent: boolean,
    recipientType = "N",
  ) =>
    db.insert(award).values({
      ministryId: dept.id,
      programId: fedProg.id,
      recipientId,
      recordKind: "agreement",
      reference,
      amendmentNumber,
      isCurrent,
      agreementType: "C",
      recipientType,
      value: String(value),
      startDate,
      description: "x".repeat(1000),
    });

  let payments = 4;
  const payment = (
    ministryId: number,
    programId: number,
    recipientId: number,
    value: number,
    startDate: string,
    startDateEstimated = false,
  ) =>
    db.insert(award).values({
      ministryId,
      programId,
      recipientId,
      recordKind: "payment",
      reference: `AB-${startDate.slice(0, 4)}-${String(payments++).padStart(7, "0")}`,
      value: String(value),
      startDate,
      startDateEstimated,
    });

  // Federal: one agreement amended (100 -> 150), one other agreement, one individual.
  await agreement("F1", 0, 100, "2024-05-01", shared.id, false);
  await agreement("F1", 1, 150, "2024-05-01", shared.id, true);
  await agreement("F2", 0, 1000, "2025-02-01", fedOnly.id, true, "F");
  await agreement("F3", 0, 20, "2024-06-01", withheld.id, true, "P");

  // Alberta: payments to the shared recipient (incl. a reversal), a variant spelling, and a
  // huge undisclosed aggregate with an estimated date.
  await payment(culture.id, abProg.id, shared.id, 40, "2024-04-02");
  await payment(culture.id, abProg.id, shared.id, -10, "2024-07-02");
  await payment(culture.id, abProg.id, variant.id, 5, "2024-08-02");
  await payment(health.id, ffs.id, undisclosed.id, 1_000_000, "2024-04-01", true);

  await db
    .insert(fiscalYear)
    .values({ year: 2024, startDate: "2024-04-01", endDate: "2025-03-31" });

  return {
    fed,
    ab,
    dept,
    health,
    culture,
    fedProg,
    abProg,
    ffs,
    shared,
    fedOnly,
    variant,
    withheld,
    undisclosed,
  };
}
