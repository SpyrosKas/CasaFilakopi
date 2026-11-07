import { createHmac, randomBytes } from "node:crypto";

// First layer of the throttle on /api/consent; see the note in route.ts.
// Addresses exist here only as keyed hashes, in memory: the key is random for
// each process and never leaves it, so nothing here can be reversed or stored.
const KEY = randomBytes(32);

const WINDOW_MS = 60_000;
const MAX_PER_CLIENT = 10;
const MAX_TRACKED = 5_000;

const clients = new Map<string, { count: number; resetAt: number }>();

/** Vercel sets this header itself, so a client cannot choose the first value. */
export function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function prune(now: number) {
  for (const [key, entry] of clients) {
    if (entry.resetAt <= now) clients.delete(key);
  }
  // Under a flood of fresh addresses, forget rather than grow without limit.
  if (clients.size >= MAX_TRACKED) clients.clear();
}

export function isClientLimited(address: string, now = Date.now()) {
  const key = createHmac("sha256", KEY).update(address).digest("base64url");
  const entry = clients.get(key);

  if (!entry || entry.resetAt <= now) {
    if (clients.size >= MAX_TRACKED) prune(now);
    clients.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_CLIENT;
}

export function resetClientLimits() {
  clients.clear();
}
