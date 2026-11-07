import type { SyncErrorCode } from "./types";

// What happened on a run besides success or failure. sync_logs has one text
// column for this, so it holds a failure code and counts, such as
// "network_error;alert_unsent:1" or "released:2;echoed:1". Counts and codes
// only: no link, name or date ever goes in.

export interface RunNotes {
  /** Events in the feed we could not read. */
  unreadable?: number;
  /** Future stays released on this run. */
  released?: number;
  /** New clashes on the exact dates of a stay we exported. No alarm raised. */
  echoed?: number;
  /** Alerts that could not be queued, such as with no notification email. */
  alertUnsent?: number;
}

const KEYS = {
  unreadable: "unreadable",
  released: "released",
  echoed: "echoed",
  alertUnsent: "alert_unsent",
} as const;

export function formatRunNotes(
  notes: RunNotes,
  error?: SyncErrorCode,
): string | null {
  const parts = (Object.keys(KEYS) as (keyof RunNotes)[]).flatMap((key) =>
    notes[key] ? [`${KEYS[key]}:${notes[key]}`] : [],
  );
  return [...(error ? [error] : []), ...parts].join(";") || null;
}

export function parseRunNotes(detail: string | null): {
  error: SyncErrorCode | null;
  notes: RunNotes;
} {
  const notes: RunNotes = {};
  let error: SyncErrorCode | null = null;

  for (const part of detail?.split(";") ?? []) {
    const [name, value] = part.split(":");
    if (value === undefined) {
      error = name as SyncErrorCode;
      continue;
    }
    for (const key of Object.keys(KEYS) as (keyof RunNotes)[]) {
      if (KEYS[key] === name) notes[key] = Number(value);
    }
  }
  return { error, notes };
}
