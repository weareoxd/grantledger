import { readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { RecordKind } from "@/lib/record-kind";

import { listColumns } from "./columns";
import * as configs from "./configs";
import type { ListConfig } from "./types";

// Each list's toggles and columns, by its API path and the organization's
// kind of record, for the server (./list_columns.json): its tests can check
// them against the API's own, so the two can't drift apart. After a change to
// the lists, `UPDATE_LIST_COLUMNS=1 npx vitest run list-columns` writes the file
const FILE = new URL("./list_columns.json", import.meta.url);
const PLACEHOLDERS = {
  organization_id: "{organization_id}",
  ministry_id: "{ministry_id}",
  program_id: "{program_id}",
  recipient_id: "{recipient_id}",
};
const KINDS: Record<string, RecordKind | undefined> = {
  agreement: "agreement",
  payment: "payment",
  // Before the organization is known, or with both (the organizations list)
  unknown: undefined,
};

/** In code point order, as the backend sorts */
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("the lists' columns, as the backend is given them", () => {
  const lists = Object.values(configs).filter(
    (value): value is ListConfig =>
      typeof value === "object" && value !== null && "endpoint" in value,
  );

  it("are one list per API path", () => {
    const paths = lists.map((config) => config.endpoint(PLACEHOLDERS));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/api/organization");
  });

  it("are those in list_columns.json", async () => {
    const columns = Object.fromEntries(
      lists
        .map((config) => {
          const toggles = Object.entries(config.toggles ?? {})
            .filter(([, enabled]) => enabled)
            .map(([toggle]) => toggle)
            .sort(byCodePoint);
          return [
            config.endpoint(PLACEHOLDERS),
            {
              toggles,
              columns: Object.fromEntries(
                Object.entries(KINDS).map(([key, kind]) => [
                  key,
                  listColumns(config, kind).map(({ id, sortable, filterable }) => ({
                    id,
                    sortable,
                    filterable,
                  })),
                ]),
              ),
            },
          ] as const;
        })
        .sort(([a], [b]) => byCodePoint(a, b)),
    );
    if (process.env.UPDATE_LIST_COLUMNS) {
      await writeFile(FILE, `${JSON.stringify(columns, null, 2)}\n`);
    }
    // Read, not compared as text: the formatter lays the file out its own way
    expect(JSON.parse(await readFile(FILE, "utf8"))).toEqual(columns);
  });
});
