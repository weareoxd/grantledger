/**
 * The data version: a token that changes whenever grants data changes (an import, an admin edit,
 * pruning). Every cache key embeds it, so bumping it makes all earlier entries unreachable at
 * once; they age out of the LRU on their own.
 *
 * It lives in `app_setting` so the worker and the web server share it. The web server reads it
 * at most every couple of seconds.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSetting } from "@/lib/db/schema";

const KEY = "data_version";
const MEMO_MS = 2000;

type VersionGlobal = {
  __grantsVersion?: { value: string; at: number };
  __grantsVersionRead?: Promise<string>;
  /** Counts bumps in this process, so a read that started before one can't undo it. */
  __grantsVersionBumps?: number;
};
const store = globalThis as VersionGlobal;

function newToken() {
  return process.hrtime.bigint().toString(16) + Date.now().toString(16);
}

async function readVersion(): Promise<string | undefined> {
  const rows = await getDb().execute<{ value: string }>(
    sql`select value #>> '{}' as value from ${appSetting} where ${appSetting.key} = ${KEY}`,
  );
  return rows.rows[0]?.value;
}

/** The current data version: read at most every couple of seconds, by one query at a time. */
export function getDataVersion(): Promise<string> {
  const memo = store.__grantsVersion;
  if (memo && Date.now() - memo.at < MEMO_MS) return Promise.resolve(memo.value);
  store.__grantsVersionRead ??= (async () => {
    const bumps = store.__grantsVersionBumps ?? 0;
    let value = await readVersion();
    if (value === undefined) {
      // First use of a database: set-if-absent, so racing processes converge on one token
      await getDb()
        .insert(appSetting)
        .values({ key: KEY, value: newToken() })
        .onConflictDoNothing({ target: appSetting.key });
      value = (await readVersion()) ?? newToken();
    }
    // A bump in this process meanwhile already set the newer value
    if ((store.__grantsVersionBumps ?? 0) !== bumps && store.__grantsVersion) {
      return store.__grantsVersion.value;
    }
    store.__grantsVersion = { value, at: Date.now() };
    return value;
  })().finally(() => {
    store.__grantsVersionRead = undefined;
  });
  return store.__grantsVersionRead;
}

/** Invalidate every versioned cache entry, in every process. */
export async function bumpDataVersion(): Promise<string> {
  const value = newToken();
  await getDb()
    .insert(appSetting)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
  store.__grantsVersionBumps = (store.__grantsVersionBumps ?? 0) + 1;
  store.__grantsVersion = { value, at: Date.now() };
  return value;
}
