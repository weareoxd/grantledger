/**
 * What one of an organization's records is: the Government of Canada's are
 * agreements (a value committed over a term), the Government of Alberta's are
 * payments (cash on a date). Column headers, titles and the overviews' wording
 * follow it.
 */
export type RecordKind = "agreement" | "payment";

/** Text for each kind of record, and for before the organization is known (or
 * on a page with both) */
export type KindText = Record<RecordKind | "unknown", string>;

export function kindText(text: string | KindText, kind: RecordKind | undefined): string {
  return typeof text === "string" ? text : text[kind ?? "unknown"];
}

export function isRecordKind(value: unknown): value is RecordKind {
  return value === "agreement" || value === "payment";
}
