"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server's HTML, true once React runs in the browser. Until then
 * a tap on a form button is a plain browser post, which the server refuses and
 * which skips any "are you sure?", and React overwrites a textarea with what
 * the server sent, so whatever was typed is lost. Those controls wait for this.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
