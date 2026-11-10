"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while the server renders the page and the browser hydrates it, true after: what's kept in
 * the browser (localStorage) is read only then, so the first render matches the server's
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
