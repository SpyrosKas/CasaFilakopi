"use client";

import { useSyncExternalStore } from "react";
import {
  CONSENT_MAX_AGE_MS,
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
  type ConsentChoice,
  type StoredConsent,
} from "@/content/consent";

const MAX_AGE_MS = CONSENT_MAX_AGE_MS;

type ConsentState = {
  /** null until the visitor decides, and always null during server render. */
  choice: ConsentChoice | null;
  bannerOpen: boolean;
};

// The banner is in the server HTML, so a first visit sees it without waiting
// for JavaScript. A returning visitor's browser hides it before the first
// paint: see ConsentMark, which sets html[data-consent].
const SERVER_STATE: ConsentState = { choice: null, bannerOpen: true };

/** Keeps the html mark in step, so CSS never hides an open banner. */
function markDecided(bannerOpen: boolean) {
  if (bannerOpen) delete document.documentElement.dataset.consent;
  else document.documentElement.dataset.consent = "decided";
}

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

// A choice made in another tab applies here too, e.g. withdrawing consent must
// remove the map from every open tab.
function onStorage(event: StorageEvent) {
  if (event.key !== CONSENT_STORAGE_KEY && event.key !== null) return;
  stored = readStored();
  update({ choice: stored?.choice ?? null, bannerOpen: !stored });
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function update(next: ConsentState) {
  state = next;
  markDecided(next.bannerOpen);
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
