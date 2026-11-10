"use client";

import { useCallback, useState } from "react";

import { useHydrated } from "@/hooks/use-hydrated";

/**
 * How an agreement's value is counted: spread evenly over its term, by day
 * ("annualized"), or all in the fiscal year it started. A payment has no
 * term: it counts on the day it was made
 */
export type Basis = "annualized" | "started";

/** What each basis is called, and what its counts count */
export const BASES = {
  annualized: {
    label: "Annualized",
    explained: "Each agreement's value is spread evenly over its term.",
    // "1 agreement active", "945 agreements active"
    counted: "active",
  },
  started: {
    label: "By start year",
    explained: "Each agreement's value counts in the fiscal year it started.",
    counted: "started",
  },
} as const;

const STORAGE_KEY = "overview.basis";

function load(): Basis {
  try {
    return localStorage.getItem(STORAGE_KEY) === "started" ? "started" : "annualized";
  } catch {
    return "annualized";
  }
}

/** The basis the user picked last, remembered in this browser */
export function useBasis() {
  // The default in the server's render (and hydrating it), then the browser's
  const hydrated = useHydrated();
  const [chosen, setState] = useState<Basis>();
  const basis = chosen ?? (hydrated ? load() : "annualized");
  const setBasis = useCallback((next: Basis) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered (storage blocked): still shown
    }
  }, []);
  return [basis, setBasis] as const;
}
