import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { checkFeedUrl, isBlockedAddress } from "./safe-url";
import type { FeedErrorCode } from "./types";

// Fetches one feed. Node's global fetch cannot say which address it connected
// to, so a name could pass a check and then resolve somewhere else. Here the
// check sits inside the connection: the socket can only open to an address
// that was just approved, which is what stops DNS rebinding.

export const FETCH_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  maxRedirects: 3,
};

const BLOCKED = "ERR_FEED_BLOCKED_ADDRESS";

type Resolver = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (error: Error | null, addresses: LookupAddress[]) => void,
) => void;

/** Refuses a name if any address behind it is private. */
export function createSafeLookup(
  resolve: Resolver = dnsLookup as Resolver,
): LookupFunction {
  return (hostname, options, callback) => {
    const family =
      options.family === 4 || options.family === 6 ? options.family : undefined;
    resolve(hostname, { all: true, family }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      if (
        addresses.length === 0 ||
        addresses.some(({ address }) => isBlockedAddress(address))
      ) {
        const refused: NodeJS.ErrnoException = new Error("blocked address");
        refused.code = BLOCKED;
        return callback(refused, "", 0);
      }
      if (options.all) {
        (callback as unknown as (e: null, list: LookupAddress[]) => void)(
          null,
          addresses,
        );
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    });
  };
}

export interface FeedResponse {
  status: number;
  location: string | null;
  contentEncoding: string | null;
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}

export type Opener = (url: URL, signal: AbortSignal) => Promise<FeedResponse>;

export function createOpener(
  lookup: LookupFunction = createSafeLookup(),
): Opener {
  return (url, signal) =>
    new Promise((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: "GET",
          lookup,
          signal,
          // A new connection each time: a pooled socket skips the lookup.
          agent: false,
          headers: {
            accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
            "accept-encoding": "identity",
            "user-agent": "CasaFilakopi-Calendar/1.0",
          },
        },
        (incoming) =>
          resolve({
            status: incoming.statusCode ?? 0,
            location: incoming.headers.location ?? null,
            contentEncoding: incoming.headers["content-encoding"] ?? null,
            body: incoming,
            destroy: () => incoming.destroy(),
          }),
      );
      outgoing.on("error", reject);
      outgoing.end();
    });
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

type FetchResult =
  { ok: true; text: string } | { ok: false; code: FeedErrorCode };

async function readBody(
  response: FeedResponse,
  maxBytes: number,
): Promise<FetchResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      response.destroy();
      return { ok: false, code: "too_large" };
    }
    chunks.push(chunk);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

function failureCode(error: unknown, signal: AbortSignal): FeedErrorCode {
  if (signal.aborted) return "timeout";
  return (error as NodeJS.ErrnoException)?.code === BLOCKED
    ? "blocked_address"
    : "network_error";
}

/** Never throws, and never returns text from what it could not fully read. */
export async function fetchFeed(
  raw: string,
  open: Opener = createOpener(),
  limits: typeof FETCH_LIMITS = FETCH_LIMITS,
): Promise<FetchResult> {
  const signal = AbortSignal.timeout(limits.timeoutMs);
  let address = raw;

  try {
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      const checked = checkFeedUrl(address);
      if (!checked.ok) return checked;

      const response = await open(checked.url, signal);

      if (isRedirect(response.status)) {
        response.destroy();
        if (!response.location) return { ok: false, code: "http_error" };
        address = new URL(response.location, checked.url).toString();
        continue;
      }
      if (response.status !== 200) {
        response.destroy();
        return { ok: false, code: "http_error" };
      }
      if ((response.contentEncoding ?? "identity") !== "identity") {
        // Asked for plain text. Unpacking is how a small file becomes a huge one.
        response.destroy();
        return { ok: false, code: "malformed" };
      }
      return await readBody(response, limits.maxBytes);
    }
    return { ok: false, code: "too_many_redirects" };
  } catch (error) {
    return { ok: false, code: failureCode(error, signal) };
  }
}
