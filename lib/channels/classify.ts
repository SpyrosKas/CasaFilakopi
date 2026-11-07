import type { Channel, EventKind } from "./types";

// One exact label is known to mean closed dates with no guest. Everything else
// on every channel may be a paying guest, so it is treated as a possible sale:
// too much blocking loses a sale, too little sells the house twice.

const AIRBNB_CLOSED = /^Airbnb \(Not available\)$/;

export function classifyEvent(
  channel: Channel,
  summary: string | null,
): EventKind {
  return channel === "airbnb" && AIRBNB_CLOSED.test(summary ?? "")
    ? "block"
    : "ambiguous";
}
