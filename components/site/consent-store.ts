"use client";

import { useSyncExternalStore } from "react";
import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
  type ConsentChoice,
  type StoredConsent,
} from "@/content/consent";

// Ask again after six months, as most EU regulators advise.
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

type ConsentState = {
  /** null until the visitor decides, and always null during server render. */
  choice: ConsentChoice | null;
  bannerOpen: boolean;
};

const SERVER_STATE: ConsentState = { choice: null, bannerOpen: false };

let state: ConsentState | null = null;
let stored: StoredConsent | null = null;
const listeners = new Set<() => void>();

function readStored(): StoredConsent | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredConsent;
    const current =
      value.version === COOKIE_POLICY_VERSION &&
      Date.now() - value.at < MAX_AGE_MS;
    return current ? value : null;
  } catch {
    return null;
  }
}

function getSnapshot(): ConsentState {
  if (!state) {
    stored = readStored();
    state = { choice: stored?.choice ?? null, bannerOpen: !stored };
  }
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(next: ConsentState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function decideConsent(choice: ConsentChoice) {
  const id = stored?.id ?? crypto.randomUUID();
  stored = { choice, id, version: COOKIE_POLICY_VERSION, at: Date.now() };
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode: the choice still holds for this page view.
  }
  update({ choice, bannerOpen: false });

  // The visitor's choice applies either way; the log is best effort.
  void fetch("/api/consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      granted: choice === "accepted",
      policyVersion: COOKIE_POLICY_VERSION,
      subject: id,
    }),
  }).catch(() => {});
}

export function openConsentBanner() {
  update({ ...getSnapshot(), bannerOpen: true });
}

export function useConsent() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_STATE);
}
