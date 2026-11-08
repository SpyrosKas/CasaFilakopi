import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guestWorkbook,
  isNameCandidate,
  isSamePerson,
  type GuestDataExport,
} from "@/lib/admin/guest-export";
import { summariseJobs } from "@/lib/admin/job-health";
import { adminEn } from "@/lib/admin/strings";
import {
  logError,
  logInfo,
  maskText,
  parseSentryDsn,
  safeFields,
  sentryEnvelope,
} from "@/lib/log";
import {
  isIndexable,
  publicContentSecurityPolicy,
  publicSecurityHeaders,
} from "@/lib/security-headers";
import { alternatesFor, jsonForScript, lodgingBusiness } from "@/lib/seo";
import { readWorkbook } from "../read-xlsx";

const emptyData: GuestDataExport = {
  guest: null,
  identity: { emails: [], phones: [], names: [] },
  bookings: [],
  payments: [],
  refunds: [],
  invoices: [],
  imported: [],
  messages: [],
  emails: [],
  consents: [],
  candidates: { imported: [], messages: [] },
};

describe("guest data file", () => {
  const data: GuestDataExport = {
    ...emptyData,
    guest: {
      id: "x",
      email: "maria@example.test",
      full_name: "=1+1",
      phone: "+30 694 000",
      country: "GR",
      locale: "el",
      marketing_consent: true,
      created_at: "2026-01-02T10:00:00Z",
    },
    bookings: [
      {
        reference: "CF-1",
        status: "completed",
        source: "direct",
        check_in: "2026-06-01",
        check_out: "2026-06-05",
        adults: 2,
        children: 0,
        guest_name: "Maria",
        guest_email: "maria@example.test",
        guest_phone: null,
        guest_country: null,
        arrival_time: "18:00",
        special_requests: "A cot",
        internal_notes: "Kind guest",
        cancellation_reason: null,
        total_cents: 123456,
        created_at: "2026-01-02T10:00:00Z",
      },
    ],
    invoices: [
      {
        document_number: "R-000001",
        doc_type: "receipt",
        status: "issued",
        issued_at: "2026-06-05T10:00:00Z",
        total_cents: 123456,
        customer: { name: "Maria P", country: "GR" },
      },
    ],
  };

  it("is a real workbook with a sheet for each kind of record", async () => {
    const workbook = await readWorkbook(guestWorkbook(data, adminEn));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Guest",
      "Bookings",
      "Payments",
      "Refunds",
      "Invoices",
      "Imported stays",
      "Messages",
      "Emails",
      "Consents",
    ]);
    const bookings = workbook.getWorksheet("Bookings")!;
    expect(bookings.getRow(2).getCell(1).value).toBe("CF-1");
    expect(bookings.getRow(2).getCell(16).value).toBe(1234.56);
    expect(workbook.getWorksheet("Invoices")!.getRow(2).getCell(6).value).toBe(
      "Maria P, GR",
    );
  });

  it("keeps a formula-like name as text", async () => {
    const workbook = await readWorkbook(guestWorkbook(data, adminEn));
    expect(workbook.getWorksheet("Guest")!.getRow(2).getCell(2).value).toBe(
      "=1+1",
    );
  });

  it("opens with no data at all", async () => {
    const workbook = await readWorkbook(guestWorkbook(emptyData, adminEn));
    expect(workbook.worksheets).toHaveLength(9);
  });
});

describe("isSamePerson", () => {
  const identity = {
    emails: ["Maria@Example.test"],
    phones: ["+30 694 111 2222"],
    names: ["Maria P"],
  };
  const row = (fields: Partial<Parameters<typeof isSamePerson>[0]>) => ({
    email: null,
    phone: null,
    name: null,
    ...fields,
  });

  it("matches an exact email or a real phone, ignoring case and spacing", () => {
    expect(isSamePerson(row({ email: " maria@example.TEST " }), identity)).toBe(
      true,
    );
    expect(isSamePerson(row({ phone: "306941112222" }), identity)).toBe(true);
  });

  it("never matches on a name alone", () => {
    expect(isSamePerson(row({ name: "maria p" }), identity)).toBe(false);
  });

  it("does not match blanks, someone else, or a short number", () => {
    expect(isSamePerson(row({}), identity)).toBe(false);
    expect(isSamePerson(row({ email: "x@example.test" }), identity)).toBe(
      false,
    );
    expect(
      isSamePerson(row({ phone: "2026" }), { ...identity, phones: ["2026"] }),
    ).toBe(false);
  });

  it("offers a name-only match as a candidate, and nothing stronger", () => {
    expect(isNameCandidate(row({ name: "Maria P" }), identity)).toBe(true);
    expect(isNameCandidate(row({ name: "Someone" }), identity)).toBe(false);
    expect(
      isNameCandidate(
        row({ name: "Maria P", email: "maria@example.test" }),
        identity,
      ),
    ).toBe(false);
  });
});

describe("candidates in the file", () => {
  const stay = {
    id: "e",
    channel: "airbnb",
    start_date: "2026-01-01",
    end_date: "2026-01-02",
    summary: null,
    guest_name: "Maria",
    guest_email: null,
    guest_phone: null,
    guest_notes: null,
    amount_cents: null,
  };
  const data = {
    ...emptyData,
    candidates: { imported: [stay], messages: [] },
  };

  it("leaves them out by default, and adds them only when asked", async () => {
    const without = await readWorkbook(guestWorkbook(data, adminEn));
    expect(without.getWorksheet("Imported stays")!.rowCount).toBe(1);
    const included = await readWorkbook(guestWorkbook(data, adminEn, true));
    expect(included.getWorksheet("Imported stays")!.rowCount).toBe(2);
  });
});

describe("summariseJobs", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const beat = (hoursAgo: number) => ({
    job: "job_health",
    status: "success",
    started_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  });

  it("is quiet when everything ran", () => {
    expect(summariseJobs([beat(1)], now)).toEqual({
      failed: [],
      stale: [],
      siteSilent: false,
    });
  });

  it("names a database job whose last run failed", () => {
    const at = "2026-11-07T02:41:00Z";
    expect(
      summariseJobs(
        [
          beat(1),
          { job: "apply_retention", status: "failed", started_at: at },
          {
            job: "purge_admin_attempts",
            status: "success",
            started_at: at,
          },
        ],
        now,
      ).failed,
    ).toEqual([{ job: "apply_retention", at }]);
  });

  it("notices when the site's jobs stop, or never started", () => {
    expect(summariseJobs([beat(4)], now).siteSilent).toBe(true);
    expect(summariseJobs([], now).siteSilent).toBe(true);
  });

  it("counts a failed heartbeat as silent", () => {
    expect(
      summariseJobs([{ ...beat(1), status: "failed" }], now).siteSilent,
    ).toBe(true);
  });

  it("gives each job its own maximum age", () => {
    const run = (job: string, hoursAgo: number) => ({
      job,
      status: "success",
      started_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
    });
    expect(
      summariseJobs(
        [
          beat(1),
          run("release_expired_holds", 4),
          run("complete_finished_bookings", 4),
          run("apply_retention", 31),
          run("scheduled_emails", 2),
          run("cms_cleanup", 31),
        ],
        now,
      ).stale,
    ).toEqual(["release_expired_holds", "apply_retention", "cms_cleanup"]);
  });
});

describe("logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("drops anything that is not a number, flag or short code", () => {
    expect(
      safeFields({
        count: 2,
        ok: true,
        job: "email_queue",
        who: "maria@example.test",
        note: "Maria Papadopoulou",
        object: { email: "maria@example.test" },
      }),
    ).toEqual({
      count: 2,
      ok: true,
      job: "email_queue",
      who: "[removed]",
      note: "[removed]",
    });
  });

  it("masks addresses and phone numbers in error text", () => {
    const masked = maskText("Bad address maria@example.test, +30 694 111 2222");
    expect(masked).not.toContain("maria");
    expect(masked).not.toContain("111");
  });

  it("masks links, which hold secrets", () => {
    const masked = maskText(
      "fetch https://miloscasa.com/en/booking/s3cret and /el/booking/s3cret and /api/ical/s3cret.ics failed",
    );
    expect(masked).not.toContain("s3cret");
    expect(maskText("postgres://user:pw@db/x")).toBe("[url]");
  });

  it("keeps a path out of a log field", () => {
    expect(safeFields({ path: "/en/booking/s3cret" })).toEqual({
      path: "[removed]",
    });
  });

  it("writes one JSON line with no personal data", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("done", { email: "maria@example.test", count: 1 });
    const line = JSON.parse(write.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "info",
      event: "done",
      email: "[removed]",
      count: 1,
    });
  });

  it("accepts only an EU Sentry project", () => {
    expect(parseSentryDsn("https://abc@o1.ingest.de.sentry.io/123")?.url).toBe(
      "https://o1.ingest.de.sentry.io/api/123/envelope/",
    );
    expect(parseSentryDsn("https://abc@o1.ingest.us.sentry.io/123")).toBeNull();
    expect(parseSentryDsn("https://abc@o1.ingest.sentry.io/123")).toBeNull();
    expect(parseSentryDsn("http://abc@o1.ingest.de.sentry.io/123")).toBeNull();
    expect(parseSentryDsn(undefined)).toBeNull();
    expect(parseSentryDsn("nonsense")).toBeNull();
  });

  it("sends Sentry the event and error type, never the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "https://abc@o1.ingest.de.sentry.io/123");
    const send = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(
      async () => ({ ok: true }),
    );
    vi.stubGlobal("fetch", send);
    await logError("contact.failed", new TypeError("maria@example.test"), {
      guest: "maria@example.test",
    });
    vi.unstubAllGlobals();
    expect(send).toHaveBeenCalledOnce();
    const body = String(send.mock.calls[0][1].body);
    expect(body).toContain("contact.failed");
    expect(body).toContain("TypeError");
    expect(body).not.toContain("maria");
  });

  it("stays silent with no DSN", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await logError("x", new Error("y"));
    vi.unstubAllGlobals();
    expect(send).not.toHaveBeenCalled();
  });

  it("builds an envelope of three lines", () => {
    const lines = sentryEnvelope("e", "Error", {}, new Date()).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1])).toEqual({ type: "event" });
  });
});

describe("jsonForScript", () => {
  it("cannot end the script tag, and is still the same JSON", () => {
    const value = { name: "</script><script>alert(1)</script>&" };
    const text = jsonForScript(value);
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
    expect(JSON.parse(text)).toEqual(value);
  });

  it("escapes the line separators JavaScript treats as newlines", () => {
    const value = { name: `a${String.fromCharCode(0x2028)}b` };
    const text = jsonForScript(value);
    expect(text).toContain("\\u2028");
    expect(JSON.parse(text)).toEqual(value);
  });
});

describe("alternatesFor", () => {
  it("gives the canonical and every language, with a default", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://miloscasa.com/");
    expect(alternatesFor("/host", "el")).toEqual({
      canonical: "https://miloscasa.com/el/host",
      languages: {
        en: "https://miloscasa.com/en/host",
        el: "https://miloscasa.com/el/host",
        "x-default": "https://miloscasa.com/en/host",
      },
    });
    vi.unstubAllEnvs();
  });
});

describe("lodgingBusiness", () => {
  it("leaves out what is unknown", () => {
    const data = lodgingBusiness({
      name: "Casa Filakopi",
      url: "https://miloscasa.com/en",
      addressLines: ["", ""],
    });
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "LodgingBusiness",
      name: "Casa Filakopi",
      url: "https://miloscasa.com/en",
    });
  });

  it("takes times as HH:MM and the registration as an identifier", () => {
    const data = lodgingBusiness({
      name: "Casa Filakopi",
      url: "https://miloscasa.com/en",
      addressLines: ["Filakopi", "Milos"],
      checkInTime: "15:00:00",
      checkOutTime: "11:00:00",
      maxOccupancy: 6,
      registrationNumber: "12345",
    });
    expect(data).toMatchObject({
      checkinTime: "15:00",
      checkoutTime: "11:00",
      identifier: "12345",
      occupancy: { maxValue: 6 },
      address: { streetAddress: "Filakopi, Milos", addressCountry: "GR" },
    });
  });
});

describe("indexing", () => {
  it("indexes only the production host, or by an explicit flag", () => {
    const off = undefined;
    expect(isIndexable("https://miloscasa.com", off, off)).toBe(true);
    expect(isIndexable("https://www.miloscasa.com/", "", off)).toBe(true);
    expect(isIndexable("https://staging.miloscasa.com", off, off)).toBe(false);
    expect(isIndexable("https://casa-filakopi.vercel.app", "", off)).toBe(
      false,
    );
    expect(isIndexable("https://casa-filakopi.vercel.app", "true", off)).toBe(
      true,
    );
    expect(isIndexable("https://miloscasa.com.evil.test", "false", off)).toBe(
      false,
    );
    expect(isIndexable(off, off, off)).toBe(false);
  });

  it("on Vercel, only a production deployment is indexed", () => {
    const site = "https://miloscasa.com";
    expect(isIndexable(site, undefined, "production")).toBe(true);
    expect(isIndexable(site, undefined, "preview")).toBe(false);
    expect(isIndexable(site, "true", "preview")).toBe(false);
    expect(isIndexable(site, undefined, "development")).toBe(false);
    expect(isIndexable("https://x.vercel.app", "", "production")).toBe(false);
  });

  it("sends noindex only where the site is not indexable", () => {
    const names = (indexable: boolean) =>
      publicSecurityHeaders(false, indexable).map((header) => header.key);
    expect(names(false)).toContain("X-Robots-Tag");
    expect(names(true)).not.toContain("X-Robots-Tag");
  });
});

describe("public Content-Security-Policy", () => {
  const policy = publicContentSecurityPolicy(false);
  const directive = (name: string) =>
    policy.split("; ").find((part) => part.startsWith(`${name} `));

  it("allows what the site needs", () => {
    expect(directive("script-src")).toContain(
      "https://challenges.cloudflare.com",
    );
    expect(directive("frame-src")).toBe(
      "frame-src https://www.google.com https://challenges.cloudflare.com",
    );
    expect(directive("form-action")).toBe(
      "form-action 'self' https://checkout.stripe.com",
    );
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });

  it("keeps development allowances out of production", () => {
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("ws:");
    expect(publicContentSecurityPolicy(true)).toContain("unsafe-eval");
  });
});
