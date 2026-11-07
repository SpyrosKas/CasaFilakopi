import { BlockList, isIP } from "node:net";
import type { FeedErrorCode } from "./types";

// Yorgos types these addresses, and a feed can redirect anywhere, so the server
// must never be talked into calling something on its own network.

const MAX_URL_LENGTH = 2_048;

// Two lists, because a list checks IPv4 against its IPv6 rules too: the first
// rule below would otherwise match every IPv4 address there is.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(network, prefix, "ipv4");
}

// Everything but 2000::/3, so a new special range fails closed, then the parts
// of that which tunnel to IPv4 or are for documentation.
for (const [network, prefix] of [
  ["::", 3],
  ["4000::", 2],
  ["8000::", 1],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const) {
  blockedV6.addSubnet(network, prefix, "ipv6");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, "ipv4");
  if (family === 6) return blockedV6.check(address, "ipv6");
  return true;
}

const PRIVATE_NAME =
  /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/i;

export type UrlCheck =
  | { ok: true; url: URL }
  | {
      ok: false;
      code: Extract<FeedErrorCode, "bad_url" | "not_https" | "blocked_address">;
    };

/** Runs on the first address and on every redirect. */
export function checkFeedUrl(raw: string): UrlCheck {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, code: "bad_url" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "bad_url" };
  }

  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  if (url.username || url.password) return { ok: false, code: "bad_url" };
  // Calendars are public web pages. Any other port is an internal service.
  if (url.port !== "") return { ok: false, code: "blocked_address" };

  // URL has already turned odd spellings such as 2130706433 into 127.0.0.1.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, code: "blocked_address" }
      : { ok: true, url };
  }
  if (!host.includes(".") || PRIVATE_NAME.test(host)) {
    return { ok: false, code: "blocked_address" };
  }
  return { ok: true, url };
}

/** All Yorgos ever sees again of a saved address: the secret is in the rest. */
export function maskFeedUrl(raw: string): string {
  try {
    return `${new URL(raw).hostname}/••••••••`;
  } catch {
    return "••••••••";
  }
}
