import { z } from "zod";
import { parseEuros } from "@/lib/admin/format";
import { later } from "@/lib/admin/later";
import { daysBetween, isValidIsoDate } from "@/lib/domain/dates";

// Server-side validation for the bookings, calendar, prices and messages
// actions. Form values arrive as strings.

const v = later.admin.validation;

/** A range longer than this is a slip of the finger. */
const MAX_RANGE_DAYS = 731;

const trimmed = (max: number) => z.string().trim().max(max, v.tooLong);
const required = (max: number) => trimmed(max).min(1, v.required);
const optional = (max: number) =>
  trimmed(max)
    .optional()
    .transform((value) => value || null);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email(v.email).max(254, v.email));
const optionalEmail = z
  .union([z.literal(""), email])
  .optional()
  .transform((value) => value || null);

const date = z.string().refine(isValidIsoDate, v.date);
const optionalDate = z
  .union([z.literal(""), date])
  .optional()
  .transform((value) => value || null);

const count = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, message)
    .transform(Number)
    .pipe(z.int(message).min(min, message).max(max, message));

const optionalCount = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || null)
  .pipe(
    z
      .string()
      .regex(/^[1-9]\d{0,3}$/, v.wholeNumber)
      .transform(Number)
      .nullable(),
  );

/** Whole cents from a box in euros. Never a float. */
const euros = z.string().transform((value, ctx) => {
  const cents = parseEuros(value);
  if (cents === null) {
    ctx.addIssue({ code: "custom", message: v.euros });
    return z.NEVER;
  }
  return cents;
});

const positiveEuros = euros.refine((cents) => cents > 0, v.eurosPositive);

const optionalEuros = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value?.trim()) return null;
    const cents = parseEuros(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: v.euros });
      return z.NEVER;
    }
    return cents;
  });

const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on");

const weekdays = z
  .array(
    z
      .string()
      .regex(/^[0-6]$/)
      .transform(Number),
  )
  .max(7);

export const idSchema = z.object({ id: z.uuid() });

/**
 * Zod still runs checks across fields after one of them has failed, so a
 * blank date reaches here and must not reach the date arithmetic.
 */
const bothDates = (first: string, second: string) =>
  isValidIsoDate(first) && isValidIsoDate(second);

const stayDates = {
  checkIn: date,
  checkOut: date,
};

function datesInOrder<T extends { checkIn: string; checkOut: string }>(
  value: T,
  ctx: z.RefinementCtx,
) {
  if (!bothDates(value.checkIn, value.checkOut)) return;
  if (value.checkOut <= value.checkIn) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: v.dateOrder,
    });
  } else if (daysBetween(value.checkIn, value.checkOut) > MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["checkOut"],
      message: v.tooLongRange,
    });
  }
}

export const newBookingSchema = z
  .object({
    ...stayDates,
    name: required(160),
    email: optionalEmail,
    phone: optional(40),
    country: optional(60),
    locale: z.enum(["en", "el"], v.pick),
    adults: count(1, 30, v.adultsCount),
    children: count(0, 30, v.guestsCount),
    source: z.enum(["manual", "other"], v.pick),
    notes: optional(2000),
    expectedTotal: z.string().regex(/^\d+$/).transform(Number).optional(),
  })
  .superRefine(datesInOrder);

export const changeDatesSchema = z
  .object({
    id: z.uuid(),
    ...stayDates,
    expectedTotal: z.string().regex(/^\d+$/).transform(Number).optional(),
  })
  .superRefine(datesInOrder);

export const transitionSchema = z.object({
  id: z.uuid(),
  to: z.enum(["checked_in", "completed", "no_show"]),
});

const expectedCents = z.string().regex(/^\d+$/).transform(Number);

export const notesSchema = z.object({
  id: z.uuid(),
  notes: trimmed(2000),
});

export const paymentSchema = z.object({
  id: z.uuid(),
  /** What the form saw, so a second tab or a repeat tap cannot pay twice. */
  expectedReceived: expectedCents,
  amount: positiveEuros,
  method: z.enum(["cash", "bank_transfer", "pos"], v.pick),
  note: optional(300),
});

export const refundSchema = z.object({
  id: z.uuid(),
  expectedRefunded: expectedCents,
  paymentId: z.uuid(v.pick),
  amount: positiveEuros,
  reason: optional(300),
});

export const cardRefundSchema = z.object({
  id: z.uuid(),
  expectedRefunded: expectedCents,
  amount: positiveEuros,
  reason: optional(300),
});

export const cancelSchema = z.object({
  id: z.uuid(),
  reason: optional(300),
  gaveBack: checkbox,
  refundCard: checkbox,
  expectedRefund: z.string().regex(/^\d+$/).transform(Number),
});

export const externalDetailsSchema = z.object({
  id: z.uuid(),
  name: optional(160),
  email: optionalEmail,
  phone: optional(40),
  notes: optional(2000),
  amount: optionalEuros,
});

export const messageSchema = z.object({
  target: z.enum(["booking", "external", "contact"]),
  id: z.uuid(),
  // A line break in a subject can add mail headers.
  subject: required(160).regex(/^[^\r\n]*$/, v.oneLine),
  body: required(5000),
});

export const messageStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["new", "replied", "archived"]),
});

export const blockSchema = z
  .object({
    from: date,
    lastNight: date,
    reason: z.enum(
      ["maintenance", "owner_use", "closed_period", "other"],
      v.pick,
    ),
    note: optional(200),
  })
  .superRefine((value, ctx) => {
    if (!bothDates(value.from, value.lastNight)) return;
    if (value.lastNight < value.from) {
      ctx.addIssue({
        code: "custom",
        path: ["lastNight"],
        message: v.dateOrder,
      });
    } else if (daysBetween(value.from, value.lastNight) > MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["lastNight"],
        message: v.tooLongRange,
      });
    }
  });

function rangeInOrder(
  value: { from: string; to: string },
  ctx: z.RefinementCtx,
) {
  if (!bothDates(value.from, value.to)) return;
  if (value.to < value.from) {
    ctx.addIssue({ code: "custom", path: ["to"], message: v.dateOrder });
  } else if (daysBetween(value.from, value.to) > MAX_RANGE_DAYS) {
    ctx.addIssue({ code: "custom", path: ["to"], message: v.tooLongRange });
  }
}

const bulkBase = z.object({
  from: date,
  to: date,
  weekdays: weekdays.min(1, v.weekdays),
});

/** A free night is possible, but never by a slip of the finger (D12). */
function zeroNeedsConfirming(
  cents: number,
  isConfirmed: boolean,
  path: string,
  ctx: z.RefinementCtx,
) {
  if (cents === 0 && !isConfirmed) {
    ctx.addIssue({ code: "custom", path: [path], message: v.zeroPrice });
  }
}

export const bulkRatesSchema = bulkBase
  .extend({ price: euros, confirmFree: checkbox })
  .superRefine(rangeInOrder)
  .superRefine((value, ctx) =>
    zeroNeedsConfirming(value.price, value.confirmFree, "price", ctx),
  );

export const clearRatesSchema = bulkBase.superRefine(rangeInOrder);

export const basePricesSchema = z
  .object({
    base: euros,
    cleaning: euros,
    extraGuest: euros,
    confirmFree: checkbox,
  })
  .superRefine((value, ctx) =>
    zeroNeedsConfirming(value.base, value.confirmFree, "base", ctx),
  );

export const seasonSchema = z
  .object({
    id: z.uuid().optional(),
    name: required(80),
    from: date,
    to: date,
    night: euros,
    weekend: optionalEuros,
  })
  .superRefine(rangeInOrder);

export const restrictionSchema = z
  .object({
    id: z.uuid().optional(),
    from: date,
    to: date,
    minStay: optionalCount,
    maxStay: optionalCount,
    noArrival: checkbox,
    noDeparture: checkbox,
    days: weekdays,
  })
  .superRefine(rangeInOrder)
  .superRefine((value, ctx) => {
    const { minStay, maxStay } = value;
    if (minStay !== null && maxStay !== null && maxStay < minStay) {
      ctx.addIssue({
        code: "custom",
        path: ["maxStay"],
        message: later.admin.rates.restrictionMaxBelowMin,
      });
    }
    const hasRule =
      minStay !== null ||
      maxStay !== null ||
      value.noArrival ||
      value.noDeparture ||
      value.days.length > 0;
    if (!hasRule) {
      ctx.addIssue({
        code: "custom",
        path: ["form"],
        message: later.admin.rates.restrictionEmptyRule,
      });
    }
  });

/** Percent to two decimals, as basis points: 13.5 becomes 1350. */
function percentToBasisPoints(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const points =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return points >= 1 && points <= 10_000 ? points : null;
}

export const feeSchema = z
  .object({
    id: z.uuid().optional(),
    nameEn: required(120),
    nameEl: required(120),
    kind: z.enum(
      ["percent", "per_stay", "per_night", "per_guest_night"],
      v.pick,
    ),
    amount: optionalEuros,
    percent: trimmed(8).optional(),
    isVat: checkbox,
    validFrom: optionalDate,
    validTo: optionalDate,
    isActive: checkbox,
  })
  .transform((value, ctx) => {
    const points =
      value.kind === "percent"
        ? percentToBasisPoints(value.percent ?? "")
        : null;
    if (value.kind === "percent" && points === null) {
      ctx.addIssue({
        code: "custom",
        path: ["percent"],
        message: later.admin.rates.feePercentNeeded,
      });
      return z.NEVER;
    }
    if (value.kind !== "percent" && value.amount === null) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: later.admin.rates.feeAmountNeeded,
      });
      return z.NEVER;
    }
    return {
      ...value,
      amount: value.kind === "percent" ? null : value.amount,
      points,
    };
  });

export const promoSchema = z
  .object({
    id: z.uuid().optional(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{2,30}$/, v.code),
    kind: z.enum(["percent", "fixed"], v.pick),
    value: z.string(),
    validFrom: optionalDate,
    validTo: optionalDate,
    maxUses: optionalCount,
    isActive: checkbox,
  })
  .transform((input, ctx) => {
    const amount =
      input.kind === "percent"
        ? percentToBasisPoints(input.value)
        : parseEuros(input.value);
    if (amount === null || amount <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: input.kind === "percent" ? v.percent : v.eurosPositive,
      });
      return z.NEVER;
    }
    return { ...input, amount };
  });

export const bookingListSchema = z.object({
  tab: z.enum(["upcoming", "staying", "past", "cancelled"]).catch("upcoming"),
  q: z.string().max(120).catch(""),
  from: date.nullable().catch(null),
  to: date.nullable().catch(null),
  status: z.string().max(30).nullable().catch(null),
  source: z.string().max(30).nullable().catch(null),
  money: z.string().max(30).nullable().catch(null),
});
