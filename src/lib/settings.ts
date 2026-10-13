import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSetting } from "@/lib/db/schema";

/** App settings stored in `app_setting`, with their defaults. */
export interface AppSettings {
  /** Stops scheduled imports (manual "Run now" still works). */
  paused: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { paused: false };

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const [row] = await getDb().select().from(appSetting).where(eq(appSetting.key, key));
  return (row?.value as AppSettings[K] | undefined) ?? DEFAULT_SETTINGS[key];
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await putSetting(key, value);
}

async function putSetting(key: string, value: unknown) {
  await getDb()
    .insert(appSetting)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } });
}

/**
 * What the last successful import of a file downloaded, to skip an unchanged file next time. Kept
 * per file: the live Alberta export, the federal file, and each yearly Alberta archive.
 */
export interface FileState {
  etag: string | null;
  lastModified: string | null;
  size: number | null;
  sha256: string | null;
  /** The name it was imported as (the Alberta export is named by its fiscal year). */
  sourceFile: string | null;
  importedAt: string | null;
}

const fileKey = (key: string) => `file:${key}`;

export async function getFileStates(keys: readonly string[]): Promise<Record<string, FileState>> {
  if (!keys.length) return {};
  const rows = await getDb()
    .select()
    .from(appSetting)
    .where(inArray(appSetting.key, keys.map(fileKey)));
  return Object.fromEntries(
    rows.map((row) => [row.key.slice("file:".length), row.value as FileState]),
  );
}

export async function getFileState(key: string): Promise<FileState | null> {
  return (await getFileStates([key]))[key] ?? null;
}

export async function setFileState(key: string, state: FileState) {
  await putSetting(fileKey(key), state);
}
