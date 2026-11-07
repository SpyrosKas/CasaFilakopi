import type { Channel, EventKind } from "./types";

// Labels seen in real feeds. A label nobody recognises counts as ambiguous, so
// it still blocks the other channels: too much blocking loses a sale, too
// little sells the house twice.

const BLOCK_LABEL = /not available|unavailable|blocked|closed/i;
const RESERVED_LABEL = /^reserved\b/i;

export function classifyEvent(
  channel: Channel,
  summary: string | null,
): EventKind {
  // "CLOSED - Not available" covers real bookings and closed dates alike.
  if (channel === "booking_com") return "ambiguous";
  const label = summary?.trim() ?? "";
  if (RESERVED_LABEL.test(label)) return "reservation";
  return BLOCK_LABEL.test(label) ? "block" : "ambiguous";
}
