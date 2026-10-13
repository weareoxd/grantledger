// The contract between the UI's lists (src/features/lists/configs.ts, written out to
// list_columns.json by its own test) and the API's column specs: every column the UI offers is one
// the API serves for that kind of record, sorts and filters the same way, and every toggle the UI
// shows is one the API takes.
import { describe, expect, it } from "vitest";
import contract from "@/features/lists/list_columns.json";
import type { RecordKind } from "@/lib/domain";
import { applicable, LIST_SPECS } from "@/lib/rest/columns";

const KINDS: Record<string, string> = {
  "/api/organization": "organizations",
  "/api/organization/{organization_id}/ministry": "org_ministries",
  "/api/organization/{organization_id}/recipient": "org_recipients",
  "/api/organization/{organization_id}/ministry/{ministry_id}/program": "ministry_programs",
  "/api/organization/{organization_id}/ministry/{ministry_id}/recipient": "ministry_recipients",
  "/api/organization/{organization_id}/ministry/{ministry_id}/program/{program_id}/recipient":
    "program_recipients",
  "/api/organization/{organization_id}/recipient/{recipient_id}/ministry": "recipient_ministries",
};

type Entry = {
  toggles: string[];
  columns: Record<string, { id: string; sortable: boolean; filterable: boolean }[]>;
};

describe("the UI's lists and the API's columns", () => {
  for (const [path, entry] of Object.entries(contract as Record<string, Entry>)) {
    const kind = KINDS[path] ?? (path.endsWith("/award") ? "awards" : undefined);
    it(`agree on ${path}`, () => {
      expect(kind, `no API list for ${path}`).toBeDefined();
      const spec = LIST_SPECS[kind as string];
      expect(spec).toBeDefined();
      if (!spec) return;
      for (const [recordKind, columns] of Object.entries(entry.columns)) {
        const served = new Map(
          applicable(spec, recordKind === "unknown" ? null : (recordKind as RecordKind)).map(
            (col) => [col.key, col],
          ),
        );
        for (const column of columns) {
          const col = served.get(column.id);
          expect(col, `${path} (${recordKind}) has no column ${column.id}`).toBeDefined();
          expect({ id: column.id, sortable: col?.sortable, filterable: col?.filterable }).toEqual(
            column,
          );
        }
      }
      if (entry.toggles.includes("fiscalYear")) expect(spec.group).not.toBeNull();
      if (entry.toggles.includes("placeholders")) expect(spec.placeholders).toBe(true);
      if (entry.toggles.includes("superseded")) expect(spec.superseded).toBe(true);
    });
  }
});
