"use server";

/**
 * Admin edits to the grants data. Every action checks the role first (src/proxy.ts and the
 * layout's guard are only for the pages), validates with the forms' schemas, and keeps the derived
 * data right: an edit that changes totals rebuilds the rollup for the ministries it touches (as
 * the old Django admin did), and any other edit bumps the data version so cached lists and
 * summaries are recomputed.
 */
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  type AwardAdminRow,
  getAward,
  ministryOptions,
  type Option,
  organizationOptions,
  programOptions,
  recipientOptions,
} from "@/lib/admin/queries";
import { requireAdmin } from "@/lib/auth/session";
import { friendlyDbError, UserError } from "@/lib/data/errors";
import { getDb, inDbTransaction } from "@/lib/db";
import { award, fiscalYear, ministry, organization, program, recipient } from "@/lib/db/schema";
import { refreshRollup } from "@/lib/grants/rollup";
import { bumpDataVersion } from "@/lib/grants/version";
import { createLogger } from "@/lib/server/logger";
import {
  awardInput,
  fiscalYearInput,
  idInput,
  ministryInput,
  organizationInput,
  programInput,
  recipientInput,
} from "@/lib/validation/admin";
import { type ActionResult, fail, ok } from "./result";

const log = createLogger("admin");

const MESSAGES: Record<string, string> = {
  organization_name_unique: "Another government already has that name",
  organization_key_unique: "Another government already has that key",
  ministry_org_name_uniq: "This government already has a ministry with that name",
  program_ministry_name_uniq: "This ministry already has a program with that name",
  recipient_name_unique: "Another recipient already has that matching key",
  fiscal_year_year_unique: "That fiscal year already exists",
};

async function run<T>(what: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const result = await work();
    revalidatePath("/admin", "layout");
    return ok(result);
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message };
    if (error instanceof Error && error.name === "ZodError") return fail(error);
    log.error(`${what} failed`, { error });
    return fail(friendlyDbError(error, MESSAGES));
  }
}

const ministryIdsOf = async (where: ReturnType<typeof sql>) =>
  (
    await getDb().execute<{ id: number }>(
      sql`SELECT DISTINCT ministry_id AS id FROM award WHERE ${where}`,
    )
  ).rows.map((row) => row.id);

// ---------------------------------------------------------------------------
// Governments
// ---------------------------------------------------------------------------

export async function saveOrganization(input: unknown, id?: number) {
  await requireAdmin("/admin/organizations");
  return run("save organization", async () => {
    const values = organizationInput.parse(input);
    if (id) {
      const updated = await getDb()
        .update(organization)
        .set(values)
        .where(eq(organization.id, id))
        .returning();
      if (!updated.length) throw new UserError("That government no longer exists");
    } else {
      await getDb().insert(organization).values(values);
    }
    await bumpDataVersion();
  });
}

export async function deleteOrganization(input: unknown) {
  await requireAdmin("/admin/organizations");
  return run("delete organization", async () => {
    const { id } = idInput.parse(input);
    const ministries = (
      await getDb()
        .select({ id: ministry.id })
        .from(ministry)
        .where(eq(ministry.organizationId, id))
    ).map((m) => m.id);
    await getDb().delete(organization).where(eq(organization.id, id));
    await refreshRollup(ministries);
  });
}

// ---------------------------------------------------------------------------
// Ministries
// ---------------------------------------------------------------------------

export async function saveMinistry(input: unknown, id?: number) {
  await requireAdmin("/admin/ministries");
  return run("save ministry", async () => {
    const values = ministryInput.parse(input);
    if (id) {
      const [before] = await getDb().select().from(ministry).where(eq(ministry.id, id));
      if (!before) throw new UserError("That ministry no longer exists");
      await getDb().update(ministry).set(values).where(eq(ministry.id, id));
      // Its rollup rows name its government
      if (before.organizationId !== values.organizationId) await refreshRollup([id]);
      else await bumpDataVersion();
    } else {
      await getDb().insert(ministry).values(values);
      await bumpDataVersion();
    }
  });
}

export async function deleteMinistry(input: unknown) {
  await requireAdmin("/admin/ministries");
  return run("delete ministry", async () => {
    const { id } = idInput.parse(input);
    await getDb().delete(ministry).where(eq(ministry.id, id));
    await refreshRollup([id]);
  });
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function saveProgram(input: unknown, id?: number) {
  await requireAdmin("/admin/programs");
  return run("save program", async () => {
    const values = programInput.parse(input);
    if (id) {
      const [before] = await getDb().select().from(program).where(eq(program.id, id));
      if (!before) throw new UserError("That program no longer exists");
      // Its awards belong to its ministry: moving it would split them
      if (before.ministryId !== values.ministryId) {
        throw new UserError(
          "A program can't move to another ministry; rename it, or create a new one",
        );
      }
      await getDb().update(program).set({ name: values.name }).where(eq(program.id, id));
    } else {
      await getDb().insert(program).values(values);
    }
    await bumpDataVersion();
  });
}

export async function deleteProgram(input: unknown) {
  await requireAdmin("/admin/programs");
  return run("delete program", async () => {
    const { id } = idInput.parse(input);
    const [before] = await getDb().select().from(program).where(eq(program.id, id));
    if (!before) throw new UserError("That program no longer exists");
    // Its awards stay, with no program
    await getDb().delete(program).where(eq(program.id, id));
    await refreshRollup([before.ministryId]);
  });
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export async function saveRecipient(input: unknown, id?: number) {
  await requireAdmin("/admin/recipients");
  return run("save recipient", async () => {
    const values = recipientInput.parse(input);
    if (id) {
      const updated = await getDb()
        .update(recipient)
        .set(values)
        .where(eq(recipient.id, id))
        .returning();
      if (!updated.length) throw new UserError("That recipient no longer exists");
    } else {
      await getDb().insert(recipient).values(values);
    }
    await bumpDataVersion();
  });
}

export async function deleteRecipient(input: unknown) {
  await requireAdmin("/admin/recipients");
  return run("delete recipient", async () => {
    const { id } = idInput.parse(input);
    const ministries = await ministryIdsOf(sql`recipient_id = ${id}`);
    await getDb().delete(recipient).where(eq(recipient.id, id));
    if (ministries.length) await refreshRollup(ministries);
    else await bumpDataVersion();
  });
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

export async function loadAward(id: number): Promise<ActionResult<AwardAdminRow>> {
  await requireAdmin("/admin/awards");
  const found = await getAward(id);
  return found ? ok(found) : { ok: false, error: "That award no longer exists" };
}

export async function saveAward(input: unknown, id?: number) {
  await requireAdmin("/admin/awards");
  return run("save award", async () => {
    const values = awardInput.parse(input);
    if (values.programId) {
      const [owner] = await getDb()
        .select({ ministryId: program.ministryId })
        .from(program)
        .where(eq(program.id, values.programId));
      if (!owner) throw new UserError("That program no longer exists");
      if (owner.ministryId !== values.ministryId)
        throw new UserError("That program belongs to another ministry");
    }
    const row = { ...values, importDate: undefined };
    let ministries = [values.ministryId];
    if (id) {
      const [before] = await getDb()
        .select({ ministryId: award.ministryId })
        .from(award)
        .where(eq(award.id, id));
      if (!before) throw new UserError("That award no longer exists");
      await getDb().update(award).set(row).where(eq(award.id, id));
      ministries = [before.ministryId, values.ministryId];
    } else {
      await getDb()
        .insert(award)
        .values({ ...row, sourceFile: null });
    }
    // Its ministry's totals (and the old one's, if it moved)
    await refreshRollup(ministries);
  });
}

export async function deleteAward(input: unknown) {
  await requireAdmin("/admin/awards");
  return run("delete award", async () => {
    const { id } = idInput.parse(input);
    const before = await inDbTransaction(async (tx) => {
      const [deleted] = await tx.delete(award).where(eq(award.id, id)).returning({
        ministryId: award.ministryId,
        recordKind: award.recordKind,
        isCurrent: award.isCurrent,
        agreementKey: award.agreementKey,
        reference: award.reference,
      });
      // The agreement's current amendment is gone: the latest one left becomes current, chosen
      // as the importer chooses (src/lib/grants/importers/maintenance.ts), so the agreement stays
      // in the totals
      if (deleted?.recordKind === "agreement" && deleted.isCurrent) {
        const key = deleted.agreementKey ?? `ref:${deleted.reference}`;
        await tx.execute(sql`
          UPDATE award SET is_current = true
           WHERE id = (
             SELECT id FROM award
              WHERE record_kind = 'agreement' AND ministry_id = ${deleted.ministryId}
                AND COALESCE(agreement_key, 'ref:' || reference) = ${key}
              ORDER BY amendment_number DESC, amendment_date DESC NULLS LAST, id DESC
              LIMIT 1
           )`);
      }
      return deleted;
    });
    if (!before) throw new UserError("That award no longer exists");
    await refreshRollup([before.ministryId]);
  });
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

export async function saveFiscalYear(input: unknown, id?: number) {
  await requireAdmin("/admin/fiscal-years");
  return run("save fiscal year", async () => {
    const values = fiscalYearInput.parse(input);
    if (id) await getDb().update(fiscalYear).set(values).where(eq(fiscalYear.id, id));
    else await getDb().insert(fiscalYear).values(values);
    await bumpDataVersion();
  });
}

export async function deleteFiscalYear(input: unknown) {
  await requireAdmin("/admin/fiscal-years");
  return run("delete fiscal year", async () => {
    const { id } = idInput.parse(input);
    await getDb().delete(fiscalYear).where(eq(fiscalYear.id, id));
    await bumpDataVersion();
  });
}

// ---------------------------------------------------------------------------
// The forms' pickers
// ---------------------------------------------------------------------------

export async function searchOrganizations(): Promise<Option[]> {
  await requireAdmin("/admin");
  return organizationOptions();
}

export async function searchMinistries() {
  await requireAdmin("/admin");
  return ministryOptions();
}

export async function searchPrograms(ministryId: number, q: string): Promise<Option[]> {
  await requireAdmin("/admin");
  if (!Number.isSafeInteger(ministryId) || ministryId <= 0) return [];
  return programOptions(ministryId, String(q).slice(0, 200));
}

export async function searchRecipients(q: string): Promise<Option[]> {
  await requireAdmin("/admin");
  return recipientOptions(String(q).slice(0, 200));
}
