"use client";

import { useCallback, useState } from "react";

import { useHydrated } from "@/hooks/use-hydrated";

/** Column widths the user has set, in px, by column id */
export type ColumnWidths = Record<string, number>;

/** Narrower than this, a column's header can't be read */
export const MIN_COLUMN_WIDTH = 60;

const storageKey = (key: string) => `table.widths.${key}`;

// Not a list's key: the widths before the browser's are read
const SERVER_RENDER = "\0server";

function load(key: string | undefined): ColumnWidths {
  if (!key) return {};
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey(key)) ?? "{}");
    if (typeof stored !== "object" || stored === null) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && entry[1] >= MIN_COLUMN_WIDTH,
      ),
    );
  } catch {
    return {};
  }
}

/**
 * The widths the user has dragged columns to, remembered in this browser
 * per `key` (a kind of list: the same columns elsewhere get the same
 * widths). Other columns fit their content.
 */
export function useColumnWidths(key: string | undefined) {
  // None in the server's render (and hydrating it): the browser's, once hydrated
  const hydrated = useHydrated();
  const [state, setState] = useState(() =>
    hydrated ? { key, widths: load(key) } : { key: SERVER_RENDER, widths: {} },
  );
  // Another kind of list: its own widths
  let widths = state.widths;
  if (hydrated && state.key !== key) {
    widths = load(key);
    setState({ key, widths });
  }

  /**
   * Set a column's width, or (undefined) let it fit its content again.
   * `save`: remember it (not while it's being dragged)
   */
  const setWidth = useCallback(
    (id: string, width: number | undefined, save = true) => {
      setState((current) => {
        const value =
          width === undefined ? undefined : Math.max(MIN_COLUMN_WIDTH, Math.round(width));
        // Unchanged (a drag along the column's edge): nothing to draw again
        const unchanged = current.widths[id] === value;
        const next = unchanged ? current.widths : { ...current.widths };
        if (!unchanged) {
          if (value === undefined) delete next[id];
          else next[id] = value;
        }
        if (key && save) {
          try {
            localStorage.setItem(storageKey(key), JSON.stringify(next));
          } catch {
            // Storage unavailable: the widths last until the page reloads
          }
        }
        return unchanged ? current : { key, widths: next };
      });
    },
    [key],
  );

  return [widths, setWidth] as const;
}
