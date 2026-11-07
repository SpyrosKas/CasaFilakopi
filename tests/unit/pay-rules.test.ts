import { describe, expect, it, vi } from "vitest";
import type { CancellationOutcome } from "@/lib/domain/contracts";
import {
  canCheckIn,
  canCheckOut,
  isDateEnabled,
  monthWeeks,
  pickDate,
  shiftMonth,
  type CalendarRules,
} from "@/lib/payments/calendar";
import { bookingFromReleaseKey, releaseKey } from "@/lib/payments/checkout";
import { readStripeSettings, turnstileReady } from "@/lib/payments/env";
import {
  balanceSlot,
  cancelRoute,
  isRefundDelayed,
  planCardRefund,
  sessionExpiresAt,
} from "@/lib/payments/policy";
import { checkoutSchema, quoteSchema } from "@/lib/payments/schemas";

const rules: CalendarRules = {
  firstCheckIn: "2027-06-02",
  lastNight: "2027-12-31",
  taken: new Set(["2027-06-10", "2027-06-11"]),
};

describe("calendar", () => {
  it("lays a month out from Monday", () => {
    const weeks = monthWeeks("2027-06");
    expect(weeks[0]).toEqual([
      null,
      "2027-06-01",
      "2027-06-02",
      "2027-06-03",
      "2027-06-04",
      "2027-06-05",
      "2027-06-06",
    ]);
    expect(weeks.at(-1)?.at(-1)).toBeNull();
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("crosses the year when moving months", () => {
    expect(shiftMonth("2027-12", 1)).toBe("2028-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it("refuses an arrival before the first date, after the last, or taken", () => {
    expect(canCheckIn("2027-06-01", rules)).toBe(false);
    expect(canCheckIn("2027-06-02", rules)).toBe(true);
    expect(canCheckIn("2027-06-10", rules)).toBe(false);
    expect(canCheckIn("2028-01-01", rules)).toBe(false);
  });

  it("lets a stay end on a taken date but not run through one", () => {
    expect(canCheckOut("2027-06-10", "2027-06-05", rules)).toBe(true);
    expect(canCheckOut("2027-06-11", "2027-06-05", rules)).toBe(false);
    expect(canCheckOut("2027-06-12", "2027-06-05", rules)).toBe(false);
    expect(canCheckOut("2027-06-05", "2027-06-05", rules)).toBe(false);
  });

  it("lets the last night on sale be slept", () => {
    expect(canCheckOut("2028-01-01", "2027-12-30", rules)).toBe(true);
    expect(canCheckOut("2028-01-02", "2027-12-30", rules)).toBe(false);
  });

  it("offers a taken date only as a departure", () => {
    const open = { checkIn: "2027-06-05", checkOut: null };
    expect(isDateEnabled("2027-06-10", open, rules)).toBe(true);
    expect(isDateEnabled("2027-06-11", open, rules)).toBe(false);
    expect(
      isDateEnabled("2027-06-10", { checkIn: null, checkOut: null }, rules),
    ).toBe(false);
  });

  it("starts, finishes and restarts a selection", () => {
    const empty = { checkIn: null, checkOut: null };
    const started = pickDate(empty, "2027-06-05", rules);
    expect(started).toEqual({ checkIn: "2027-06-05", checkOut: null });
    const done = pickDate(started, "2027-06-08", rules);
    expect(done).toEqual({ checkIn: "2027-06-05", checkOut: "2027-06-08" });
    expect(pickDate(done, "2027-06-20", rules)).toEqual({
      checkIn: "2027-06-20",
      checkOut: null,
    });
    // An earlier date restarts rather than going backwards.
    expect(pickDate(started, "2027-06-03", rules)).toEqual({
      checkIn: "2027-06-03",
      checkOut: null,
    });
  });
});

describe("Session timing", () => {
  const hold = "2027-06-01T10:35:00.000Z";
  const at = (iso: string) => Date.parse(iso) / 1000;

  it("ends after Stripe's 30 minutes and before the hold", () => {
    expect(sessionExpiresAt(hold, 35)).toBe(at("2027-06-01T10:31:00.000Z"));
  });

  it("is the same on every call, for the idempotency key", () => {
    expect(sessionExpiresAt(hold, 35)).toBe(sessionExpiresAt(hold, 35));
  });

  it("never outlives a short hold", () => {
    expect(sessionExpiresAt(hold, 31)).toBe(at(hold));
  });

  it("keeps a balance Session open past Stripe's minimum in any slot", () => {
    const start = Date.UTC(2027, 5, 1, 10, 0);
    for (let seconds = 0; seconds < 300; seconds += 29) {
      const now = new Date(start + seconds * 1000);
      const { expiresAt } = balanceSlot(now);
      expect(expiresAt - now.getTime() / 1000).toBeGreaterThanOrEqual(30 * 60);
    }
  });

  it("gives two moments in one slot the same parameters", () => {
    const a = balanceSlot(new Date(Date.UTC(2027, 5, 1, 10, 0, 1)));
    const b = balanceSlot(new Date(Date.UTC(2027, 5, 1, 10, 4, 59)));
    expect(a).toEqual(b);
  });
});

describe("who decides a cancellation", () => {
  const outcome = (
    over: Partial<CancellationOutcome>,
  ): CancellationOutcome => ({
    refundCents: 10000,
    retainedCents: 0,
    stillOwedCents: 0,
    appliedTier: { daysBefore: 30, refundPercent: 100 },
    ...over,
  });
  const base = {
    status: "confirmed",
    today: "2027-06-01",
    checkIn: "2027-07-15",
    outcome: outcome({}),
    disputedCents: 0,
    manualRefundCents: 0,
  };

  it("cancels directly when the guest loses nothing", () => {
    expect(cancelRoute(base)).toBe("direct");
  });

  it("asks Yorgos when anything is kept", () => {
    expect(
      cancelRoute({
        ...base,
        outcome: outcome({ refundCents: 0, retainedCents: 3000 }),
      }),
    ).toBe("host");
  });

  it("asks Yorgos about a stay that has started, or rules it cannot read", () => {
    expect(cancelRoute({ ...base, status: "checked_in" })).toBe("host");
    expect(cancelRoute({ ...base, today: "2027-07-16" })).toBe("host");
    expect(cancelRoute({ ...base, outcome: null })).toBe("host");
  });

  it("asks Yorgos when a dispute or cash is involved", () => {
    expect(cancelRoute({ ...base, disputedCents: 1 })).toBe("host");
    expect(cancelRoute({ ...base, manualRefundCents: 1 })).toBe("host");
  });

  it("offers nothing on a closed booking", () => {
    for (const status of ["cancelled", "refunded", "expired", "completed"]) {
      expect(cancelRoute({ ...base, status })).toBe("closed");
    }
  });
});

describe("splitting a card refund", () => {
  const payment = (
    id: string,
    amount: number,
    day: string,
    method = "card",
  ) => ({
    id,
    method,
    status: "succeeded",
    amount_cents: amount,
    created_at: `2027-06-${day}T10:00:00Z`,
  });

  it("takes the newest payment first", () => {
    const { shares, shortCents } = planCardRefund(
      12000,
      [payment("deposit", 3000, "01"), payment("balance", 10000, "20")],
      [],
    );
    expect(shares).toEqual([
      { paymentId: "balance", amountCents: 10000 },
      { paymentId: "deposit", amountCents: 2000 },
    ]);
    expect(shortCents).toBe(0);
  });

  it("counts earlier refunds, except failed ones", () => {
    const { shares } = planCardRefund(
      500,
      [payment("a", 1000, "01")],
      [
        { payment_id: "a", status: "succeeded", amount_cents: 400 },
        { payment_id: "a", status: "failed", amount_cents: 600 },
      ],
    );
    expect(shares).toEqual([{ paymentId: "a", amountCents: 500 }]);
  });

  it("reports what will not fit, and skips cash", () => {
    const { shares, shortCents } = planCardRefund(
      2000,
      [payment("card", 1000, "01"), payment("cash", 5000, "02", "cash")],
      [],
    );
    expect(shares).toEqual([{ paymentId: "card", amountCents: 1000 }]);
    expect(shortCents).toBe(1000);
  });

  it("skips anything not succeeded", () => {
    const { shares } = planCardRefund(
      100,
      [{ ...payment("open", 1000, "01"), status: "pending" }],
      [],
    );
    expect(shares).toEqual([]);
  });
});

describe("a guest's refund", () => {
  const run = { failedCents: 0, unknownCents: 0 };

  it("is on time only when all of it went out", () => {
    expect(isRefundDelayed(0, run)).toBe(false);
    expect(isRefundDelayed(1, run)).toBe(true);
    expect(isRefundDelayed(0, { ...run, failedCents: 1 })).toBe(true);
    expect(isRefundDelayed(0, { ...run, unknownCents: 1 })).toBe(true);
  });
});

describe("the cancel page's key", () => {
  const secret = "a-secret-of-some-length";
  const id = "6c84fb90-12c4-4e5a-9e3b-2f1d4a1b0a11";

  it("round-trips", () => {
    expect(bookingFromReleaseKey(secret, releaseKey(secret, id))).toBe(id);
  });

  it("refuses a forged or foreign key", () => {
    expect(bookingFromReleaseKey(secret, `${id}.forged`)).toBeNull();
    expect(
      bookingFromReleaseKey(secret, releaseKey("another-secret", id)),
    ).toBeNull();
    expect(bookingFromReleaseKey(secret, "nonsense")).toBeNull();
  });
});

describe("Stripe settings", () => {
  const complete = {
    STRIPE_SECRET_KEY: "sk_test_1",
    STRIPE_WEBHOOK_SECRET: "whsec_1",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_1",
  };

  it("needs all three keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readStripeSettings({})).toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(
      readStripeSettings({ ...complete, STRIPE_WEBHOOK_SECRET: "" }),
    ).toBeNull();
    expect(error).toHaveBeenCalled();
    expect(readStripeSettings(complete)?.secretKey).toBe("sk_test_1");
  });

  it("refuses a test key beside a live key", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      readStripeSettings({
        ...complete,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_1",
      }),
    ).toBeNull();
  });

  it("never honours the fake server in production", () => {
    const fake = { ...complete, STRIPE_API_HOST: "127.0.0.1" };
    expect(readStripeSettings(fake)?.api?.host).toBe("127.0.0.1");
    expect(
      readStripeSettings({ ...fake, NODE_ENV: "production" })?.api,
    ).toBeUndefined();
  });
});

describe("Turnstile", () => {
  const both = {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
  };

  it("is required in production", () => {
    expect(turnstileReady({ NODE_ENV: "production" })).toBe(false);
    expect(turnstileReady({ NODE_ENV: "production", ...both })).toBe(true);
  });

  it("is skipped only outside production with neither key", () => {
    expect(turnstileReady({ NODE_ENV: "development" })).toBe(true);
    expect(
      turnstileReady({
        NODE_ENV: "development",
        TURNSTILE_SECRET_KEY: "secret",
      }),
    ).toBe(false);
  });
});

describe("what a browser may send", () => {
  const stay = {
    checkIn: "2027-07-01",
    checkOut: "2027-07-05",
    adults: 2,
    children: 0,
    locale: "en",
  };
  const guest = {
    name: "Pat Example",
    email: "PAT@Example.test",
    phone: "+30 690 000 0000",
    country: "Greece",
    marketing: false,
    acceptTerms: true,
  };

  it("takes a normal checkout and tidies the email", () => {
    const parsed = checkoutSchema.parse({ ...stay, ...guest });
    expect(parsed.email).toBe("pat@example.test");
    expect(parsed.arrivalTime).toBeUndefined();
  });

  it("refuses any amount", () => {
    for (const key of ["totalCents", "dueNowCents", "amount", "price"]) {
      expect(
        checkoutSchema.safeParse({ ...stay, ...guest, [key]: 1 }).success,
      ).toBe(false);
      expect(quoteSchema.safeParse({ ...stay, [key]: 1 }).success).toBe(false);
    }
  });

  it("insists on accepted terms", () => {
    expect(
      checkoutSchema.safeParse({ ...stay, ...guest, acceptTerms: false })
        .success,
    ).toBe(false);
  });

  it("refuses a date that does not exist", () => {
    expect(
      quoteSchema.safeParse({ ...stay, checkIn: "2027-02-30" }).success,
    ).toBe(false);
  });
});
