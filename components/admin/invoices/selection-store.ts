import { useSyncExternalStore } from "react";
import { SELECTION_LIMIT } from "@/lib/invoicing/filters";

// The ticked documents, kept for this browser tab so a selection survives
// moving between pages of results. Holds ids and amounts for the bar only: the
// server re-checks every id before doing anything with it.

export interface SelectedDocument {
  id: string;
  signedCents: number;
}

type Selection = ReadonlyMap<string, number>;

const KEY = "cf-invoice-selection";
const EMPTY: Selection = new Map();

let selection: Selection = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(stored)) {
      selection = new Map(
        stored.filter(
          (entry): entry is [string, number] =>
            typeof entry?.[0] === "string" && typeof entry?.[1] === "number",
        ),
      );
    }
  } catch {
    // Private windows can refuse storage. The selection just lasts one page.
  }
}

function replace(next: Selection) {
  selection = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // As in load().
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (!loaded) {
    loaded = true;
    load();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelection(): Selection {
  return useSyncExternalStore(
    subscribe,
    () => selection,
    () => EMPTY,
  );
}

export function toggleDocument({ id, signedCents }: SelectedDocument) {
  const next = new Map(selection);
  if (!next.delete(id) && next.size < SELECTION_LIMIT) {
    next.set(id, signedCents);
  }
  replace(next);
}

/** False when these would take the selection past the limit. */
export function addDocuments(documents: SelectedDocument[]): boolean {
  const next = new Map(selection);
  for (const { id, signedCents } of documents) next.set(id, signedCents);
  if (next.size > SELECTION_LIMIT) return false;
  replace(next);
  return true;
}

export const clearSelection = () => replace(new Map());
