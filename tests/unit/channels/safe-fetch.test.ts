import { createServer } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  createOpener,
  createSafeLookup,
  fetchFeed,
  FETCH_LIMITS,
  type FeedResponse,
  type Opener,
} from "@/lib/channels/safe-fetch";
import {
  checkFeedUrl,
  isBlockedAddress,
  maskFeedUrl,
} from "@/lib/channels/safe-url";

const secret = "https://www.airbnb.com/calendar/ical/123.ics?s=secret-token";

function reply(
  status: number,
  body = "",
  extra: Partial<FeedResponse> = {},
): FeedResponse {
  return {
    status,
    location: null,
    contentEncoding: null,
    body: (async function* () {
      yield Buffer.from(body);
    })(),
    destroy: vi.fn(),
    ...extra,
  };
}

const redirectTo = (location: string) => reply(302, "", { location });

describe("addresses", () => {
  it.each([
    "127.0.0.1",
    "127.8.8.8",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "not an address",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "54.230.1.1", "172.32.0.1", "2600:1f18::1"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe("checkFeedUrl", () => {
  it("accepts a normal https link", () => {
    expect(checkFeedUrl(secret).ok).toBe(true);
  });

  it.each([
    ["http://www.airbnb.com/a.ics", "not_https"],
    ["file:///etc/passwd", "not_https"],
    ["ftp://example.com/a", "not_https"],
    ["not a link", "bad_url"],
    ["https://user:pass@example.com/a.ics", "bad_url"],
    ["https://localhost/a.ics", "blocked_address"],
    ["https://sub.localhost/a.ics", "blocked_address"],
    ["https://localhost./a.ics", "blocked_address"],
    ["https://127.0.0.1/a.ics", "blocked_address"],
    ["https://2130706433/a.ics", "blocked_address"],
    ["https://0x7f.0.0.1/a.ics", "blocked_address"],
    ["https://0177.0.0.1/a.ics", "blocked_address"],
    ["https://[::1]/a.ics", "blocked_address"],
    ["https://[::ffff:127.0.0.1]/a.ics", "blocked_address"],
    ["https://169.254.169.254/latest/meta-data", "blocked_address"],
    ["https://metadata.google.internal/a", "blocked_address"],
    ["https://printer.local/a.ics", "blocked_address"],
    ["https://intranet/a.ics", "blocked_address"],
    ["https://example.com:8443/a.ics", "blocked_address"],
  ])("refuses %s", (url, code) => {
    expect(checkFeedUrl(url)).toEqual({ ok: false, code });
  });

  it("refuses a very long link", () => {
    expect(checkFeedUrl(`https://example.com/${"a".repeat(3_000)}`)).toEqual({
      ok: false,
      code: "bad_url",
    });
  });
});

describe("maskFeedUrl", () => {
  it("shows the site and hides everything secret", () => {
    const masked = maskFeedUrl(secret);
    expect(masked).toContain("www.airbnb.com");
    expect(masked).not.toContain("secret-token");
    expect(masked).not.toContain("123");
  });

  it("shows nothing of something that is not a link", () => {
    expect(maskFeedUrl("oops secret")).not.toContain("secret");
  });
});

describe("fetchFeed", () => {
  it("returns the text of a good response", async () => {
    const open: Opener = async () => reply(200, "BEGIN:VCALENDAR");
    expect(await fetchFeed(secret, open)).toEqual({
      ok: true,
      text: "BEGIN:VCALENDAR",
    });
  });

  it("never calls out to a refused address", async () => {
    const open = vi.fn<Opener>();
    expect(await fetchFeed("https://127.0.0.1/a.ics", open)).toEqual({
      ok: false,
      code: "blocked_address",
    });
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/a.ics",
    "https://[::1]/a.ics",
    "/../../",
  ])("does not follow a redirect to %s", async (location) => {
    const open = vi.fn<Opener>(async (url) => {
      if (url.hostname === "www.airbnb.com" && url.pathname.endsWith(".ics")) {
        return redirectTo(location);
      }
      return redirectTo("https://10.0.0.1/");
    });
    const result = await fetchFeed(secret, open);
    expect(result.ok).toBe(false);
    if (location !== "/../../") {
      expect(result).toEqual({ ok: false, code: "blocked_address" });
      expect(open).toHaveBeenCalledTimes(1);
    }
  });

  it("does not follow a redirect to plain http", async () => {
    const open: Opener = async () => redirectTo("http://www.airbnb.com/a.ics");
    expect(await fetchFeed(secret, open)).toEqual({
      ok: false,
      code: "not_https",
    });
  });

  it("follows an allowed redirect", async () => {
    const open = vi.fn<Opener>(async (url) =>
      url.pathname === "/next"
        ? reply(200, "ok")
        : redirectTo("https://cdn.airbnb.com/next"),
    );
    expect(await fetchFeed(secret, open)).toEqual({ ok: true, text: "ok" });
  });

  it("gives up on a redirect loop", async () => {
    const open = vi.fn<Opener>(async () => redirectTo(secret));
    expect(await fetchFeed(secret, open)).toEqual({
      ok: false,
      code: "too_many_redirects",
    });
    expect(open).toHaveBeenCalledTimes(FETCH_LIMITS.maxRedirects + 1);
  });

  it("treats anything but 200 as a failure", async () => {
    for (const status of [204, 304, 403, 404, 500, 503]) {
      const open: Opener = async () => reply(status, "BEGIN:VCALENDAR");
      expect(await fetchFeed(secret, open)).toEqual({
        ok: false,
        code: "http_error",
      });
    }
  });

  it("stops reading past the size limit", async () => {
    const destroy = vi.fn();
    const open: Opener = async () => ({
      ...reply(200),
      destroy,
      body: (async function* () {
        for (;;) yield Buffer.alloc(1024 * 1024);
      })(),
    });
    expect(await fetchFeed(secret, open)).toEqual({
      ok: false,
      code: "too_large",
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("does not unpack a compressed reply", async () => {
    const open: Opener = async () =>
      reply(200, "x", { contentEncoding: "gzip" });
    expect(await fetchFeed(secret, open)).toEqual({
      ok: false,
      code: "malformed",
    });
  });

  it("times out a site that never finishes", async () => {
    const open: Opener = (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    expect(
      await fetchFeed(secret, open, { ...FETCH_LIMITS, timeoutMs: 20 }),
    ).toEqual({ ok: false, code: "timeout" });
  });

  it("times out a site that sends a little forever", async () => {
    const open: Opener = async (_url, signal) => ({
      ...reply(200),
      body: (async function* () {
        for (;;) {
          signal.throwIfAborted();
          yield Buffer.from("x");
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      })(),
    });
    expect(
      await fetchFeed(secret, open, { ...FETCH_LIMITS, timeoutMs: 20 }),
    ).toEqual({ ok: false, code: "timeout" });
  });

  it("reports a dropped connection as a failure, not a short feed", async () => {
    const open: Opener = async () => ({
      ...reply(200),
      body: (async function* () {
        yield Buffer.from("BEGIN:VCALENDAR");
        throw new Error("socket hang up");
      })(),
    });
    expect(await fetchFeed(secret, open)).toEqual({
      ok: false,
      code: "network_error",
    });
  });

  it("never puts the link in what it returns", async () => {
    const open: Opener = async () => {
      throw new Error(`connect failed for ${secret}`);
    };
    expect(JSON.stringify(await fetchFeed(secret, open))).not.toContain(
      "secret-token",
    );
  });
});

describe("DNS rebinding", () => {
  type Answer = { address: string; family: number }[];

  const resolverGiving =
    (...answers: Answer[]) =>
    (
      _host: string,
      _options: unknown,
      callback: (error: Error | null, addresses: Answer) => void,
    ) =>
      callback(null, answers.shift() ?? []);

  const lookupResult = (lookup: ReturnType<typeof createSafeLookup>) =>
    new Promise<{ error: NodeJS.ErrnoException | null; value: unknown }>(
      (resolve) =>
        lookup("rebind.example", { all: true }, (error, value) =>
          resolve({ error, value }),
        ),
    );

  it("refuses a name that resolves to a private address", async () => {
    const lookup = createSafeLookup(
      resolverGiving([{ address: "127.0.0.1", family: 4 }]),
    );
    expect((await lookupResult(lookup)).error?.message).toBe("blocked address");
  });

  it("refuses when only one of several addresses is private", async () => {
    const lookup = createSafeLookup(
      resolverGiving([
        { address: "1.1.1.1", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    );
    expect((await lookupResult(lookup)).error).not.toBeNull();
  });

  it("refuses a private IPv6 answer", async () => {
    const lookup = createSafeLookup(
      resolverGiving([{ address: "::1", family: 6 }]),
    );
    expect((await lookupResult(lookup)).error).not.toBeNull();
  });

  it("refuses a name with no answers", async () => {
    const lookup = createSafeLookup(resolverGiving([]));
    expect((await lookupResult(lookup)).error).not.toBeNull();
  });

  it("passes a public answer through in both lookup forms", async () => {
    const answer = [{ address: "1.1.1.1", family: 4 }];
    const lookup = createSafeLookup(resolverGiving(answer, answer));
    expect((await lookupResult(lookup)).value).toEqual(answer);
    const single = await new Promise((resolve) =>
      lookup("x.example", {}, (_error, address, family) =>
        resolve([address, family]),
      ),
    );
    expect(single).toEqual(["1.1.1.1", 4]);
  });

  it("re-checks on every connection, so a changed answer is caught", async () => {
    const lookup = createSafeLookup(
      resolverGiving(
        [{ address: "1.1.1.1", family: 4 }],
        [{ address: "127.0.0.1", family: 4 }],
      ),
    );
    expect((await lookupResult(lookup)).error).toBeNull();
    expect((await lookupResult(lookup)).error).not.toBeNull();
  });

  it("opens no socket when the address is refused", async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };

    const open = createOpener(
      createSafeLookup(resolverGiving([{ address: "127.0.0.1", family: 4 }])),
    );
    const failure = await open(
      new URL(`https://rebind.example:${port}/feed.ics`),
      AbortSignal.timeout(2_000),
    ).catch((error: NodeJS.ErrnoException) => error);

    await new Promise((resolve) => server.close(resolve));
    expect((failure as NodeJS.ErrnoException).code).toBe(
      "ERR_FEED_BLOCKED_ADDRESS",
    );
    expect(connections).toBe(0);
  });
});
