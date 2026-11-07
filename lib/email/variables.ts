import { findTemplate } from "@/emails/registry";
import type { EmailLocale, TemplateVariables } from "@/emails/types";
import type { CancellationRules } from "@/lib/domain/contracts";
import { daysBetween } from "@/lib/domain/dates";
import type { EmailDb, EmailLogRow } from "./db";
import {
  countWord,
  describeCancellation,
  formatDate,
  formatMoney,
  formatTime,
} from "./format";
import { resolveGuestLink, type GuestLinkEnv } from "./guest-link";
import type { EmailSettings } from "./settings";

// The placeholders of one email, read from the database when it is sent. Rows
// hold ids, not copies, so a queued email never shows an out-of-date amount
// and guest details sit in as few places as possible.

const BOOKING_COLUMNS = `id, reference, status, source, room_id, check_in, check_out,
  adults, children, guest_name, guest_email, guest_phone, locale, arrival_time,
  special_requests, total_cents, price_breakdown, rules_snapshot,
  access_token_hash, access_token_expires_at, created_at`;

/** Never owed by the guest in any email: D24 for cancelled, nothing for the rest. */
const CLOSED: readonly string[] = [
  "cancelled",
  "refunded",
  "expired",
  "no_show",
];

export const isClosedBooking = (status: string) => CLOSED.includes(status);

export const asLocale = (value: string | null | undefined): EmailLocale =>
  value === "el" ? "el" : "en";

export interface PropertyFacts {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
}

export async function loadProperty(db: EmailDb): Promise<PropertyFacts> {
  const { data, error } = await db
    .from("property")
    .select("name, address, phone, email, check_in_time, check_out_time")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data ?? {
      name: "Casa Filakopi",
      address: null,
      phone: null,
      email: null,
      check_in_time: null,
      check_out_time: null,
    }
  );
}

export async function loadBookingForEmail(db: EmailDb, id: string) {
  const { data, error } = await db
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export type EmailBooking = NonNullable<
  Awaited<ReturnType<typeof loadBookingForEmail>>
>;

/** Paid so far, net of refunds. A disputed payment still counts as paid. */
export async function paidCents(
  db: EmailDb,
  bookingId: string,
): Promise<number> {
  const [payments, refunds] = await Promise.all([
    db
      .from("payments")
      .select("amount_cents")
      .eq("booking_id", bookingId)
      .in("status", ["succeeded", "disputed"]),
    db
      .from("refunds")
      .select("amount_cents")
      .eq("booking_id", bookingId)
      .eq("status", "succeeded"),
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (refunds.error) throw new Error(refunds.error.message);
  const sum = (rows: { amount_cents: number }[]) =>
    rows.reduce((total, row) => total + row.amount_cents, 0);
  return sum(payments.data) - sum(refunds.data);
}

/**
 * What came in, ignoring refunds. What is still owed uses this: a goodwill
 * refund never creates a debt (O1). A disputed payment was paid (D8).
 */
export async function receivedCents(
  db: EmailDb,
  bookingId: string,
): Promise<number> {
  const { data, error } = await db
    .from("payments")
    .select("amount_cents")
    .eq("booking_id", bookingId)
    .in("status", ["succeeded", "disputed"]);
  if (error) throw new Error(error.message);
  return data.reduce((total, row) => total + row.amount_cents, 0);
}

export function balanceDueOn(booking: {
  price_breakdown: unknown;
}): string | null {
  const breakdown = booking.price_breakdown as {
    balanceDueOn?: unknown;
  } | null;
  return typeof breakdown?.balanceDueOn === "string"
    ? breakdown.balanceDueOn
    : null;
}

function cancellationRules(booking: EmailBooking): CancellationRules | null {
  const snapshot = booking.rules_snapshot as {
    cancellation?: CancellationRules;
  } | null;
  return snapshot?.cancellation ?? null;
}

async function bookingValues(
  db: EmailDb,
  booking: EmailBooking,
  locale: EmailLocale,
  env: GuestLinkEnv,
  now: Date,
): Promise<TemplateVariables> {
  const paid = await paidCents(db, booking.id);
  const money = (cents: number) => formatMoney(cents, locale);
  const owed = booking.total_cents - (await receivedCents(db, booking.id));
  const dueOn = balanceDueOn(booking);
  const closed = isClosedBooking(booking.status);

  return {
    guestName: booking.guest_name,
    guestEmail: booking.guest_email,
    guestPhone: booking.guest_phone,
    reference: booking.reference,
    checkIn: formatDate(booking.check_in, locale),
    checkOut: formatDate(booking.check_out, locale),
    nights: countWord(
      daysBetween(booking.check_in, booking.check_out),
      "night",
      locale,
    ),
    guests: countWord(booking.adults + booking.children, "guest", locale),
    totalAmount: money(booking.total_cents),
    paidAmount: money(Math.max(paid, 0)),
    // D24: nothing a closed booking could have owed is ever shown to a guest.
    balanceAmount: !closed && owed > 0 ? money(owed) : null,
    balanceDueDate:
      !closed && owed > 0 && dueOn ? formatDate(dueOn, locale) : null,
    cancellationPolicy: describeCancellation(
      cancellationRules(booking),
      locale,
    ),
    bookingLink: closed ? null : await resolveGuestLink(db, booking, env, now),
    arrivalTime: booking.arrival_time,
    specialRequests: booking.special_requests,
  };
}

async function contactValues(
  db: EmailDb,
  id: string,
): Promise<TemplateVariables & { contactEmail: string }> {
  const { data, error } = await db
    .from("contact_messages")
    .select("name, email, phone, dates_of_interest, message, locale")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("contact_message_not_found");
  return {
    contactEmail: data.email,
    guestName: data.name,
    guestEmail: data.email,
    guestPhone: data.phone,
    datesOfInterest: data.dates_of_interest,
    message: data.message,
    language: data.locale === "el" ? "Ελληνικά" : "English",
  };
}

async function paymentValues(
  db: EmailDb,
  id: string,
  locale: EmailLocale,
): Promise<TemplateVariables> {
  const { data, error } = await db
    .from("payments")
    .select("amount_cents")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("payment_not_found");
  return { paymentAmount: formatMoney(data.amount_cents, locale) };
}

async function refundValues(
  db: EmailDb,
  id: string,
  locale: EmailLocale,
): Promise<TemplateVariables> {
  const { data, error } = await db
    .from("refunds")
    .select("amount_cents")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("refund_not_found");
  return { refundAmount: formatMoney(data.amount_cents, locale) };
}

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;

/** A date from a caller, formatted when it looks like one. */
const dateText = (value: unknown, locale: EmailLocale) => {
  const raw = text(value);
  if (!raw) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatDate(raw, locale) : raw;
};

function adminLink(row: EmailLogRow, env: GuestLinkEnv): string {
  const path = row.booking_id
    ? `/admin/bookings/${row.booking_id}`
    : row.contact_message_id
      ? `/admin/messages/${row.contact_message_id}`
      : "/admin";
  return new URL(path, env.siteUrl).toString();
}

export interface EmailContext {
  values: TemplateVariables;
  booking: EmailBooking | null;
  property: PropertyFacts;
  /** Where a host's reply goes when it should reach the guest directly. */
  guestReplyTo: string | null;
}

export async function buildContext(
  db: EmailDb,
  row: EmailLogRow,
  settings: EmailSettings,
  env: GuestLinkEnv,
  now: Date,
): Promise<EmailContext> {
  const locale = asLocale(row.locale);
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const property = await loadProperty(db);
  const def = findTemplate(row.template_key);
  const site = (path: string) => new URL(path, env.siteUrl).toString();

  const values: TemplateVariables = {
    houseName: property.name,
    address: property.address,
    hostPhone: property.phone,
    hostEmail: settings.replyTo,
    checkInTime: formatTime(property.check_in_time),
    checkOutTime: formatTime(property.check_out_time),
    siteLink: site(`/${locale}`),
    directionsLink: site(`/${locale}/directions`),
    adminLink: adminLink(row, env),
  };

  const booking = row.booking_id
    ? await loadBookingForEmail(db, row.booking_id)
    : null;
  let guestReplyTo: string | null = null;

  if (booking) {
    Object.assign(values, await bookingValues(db, booking, locale, env, now));
    if (def?.audience === "host") guestReplyTo = booking.guest_email;
  }
  if (row.contact_message_id) {
    const { contactEmail, ...contact } = await contactValues(
      db,
      row.contact_message_id,
    );
    // A note to a guest may also hang on a message. Booking details then win.
    Object.assign(values, booking ? { message: contact.message } : contact);
    if (def?.audience === "host") guestReplyTo = contactEmail;
  }

  if (typeof payload.paymentId === "string") {
    Object.assign(values, await paymentValues(db, payload.paymentId, locale));
  }
  if (typeof payload.refundId === "string") {
    Object.assign(values, await refundValues(db, payload.refundId, locale));
  }

  const refundCents = payload.refundCents;
  if (typeof refundCents === "number" && refundCents > 0) {
    values.refundAmount = formatMoney(refundCents, locale);
  }
  const amountCents = payload.amountCents;
  if (typeof amountCents === "number") {
    values.paymentAmount = formatMoney(amountCents, locale);
  }

  // Free text from the host or from another track's alert.
  Object.assign(
    values,
    Object.fromEntries(
      Object.entries({
        messageSubject: text(payload.subject),
        message: text(payload.body) ?? text(payload.message),
        changes: text(payload.changes),
        reason: text(payload.reason),
        channel: text(payload.channel),
        summary: text(payload.summary),
        failures: text(payload.failures),
        errorDetail: text(payload.error),
        jobName: text(payload.job),
        recipient: text(payload.recipient),
        emailName: text(payload.emailName),
        documentNumber: text(payload.documentNumber),
        checkIn: dateText(payload.checkIn, locale),
        checkOut: dateText(payload.checkOut, locale),
      }).filter(([, value]) => value !== undefined),
    ),
  );

  return { values, booking, property, guestReplyTo };
}
