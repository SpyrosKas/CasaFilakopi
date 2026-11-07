import "server-only";
import type { MoneyMove, ReportInput } from "@/lib/admin/reports";
import type { AdminContext } from "@/lib/admin/session";
import {
  stayFromBooking,
  stayFromExternal,
  type ExternalInput,
  type PaymentRow,
  type RefundRow,
  type Stay,
} from "@/lib/admin/stays";
import type { CalendarBlock } from "@/lib/admin/calendar";
import { athensDate } from "@/lib/domain/dates";

// Reads for the operations screens, through the admin's own client, so the
// database's own rules apply on top of the page's role check.

const PAGE_SIZE = 1000;

/**
 * PostgREST returns at most 1000 rows. A report that quietly stopped there
 * would show the wrong money, so every list is read to its end.
 */
async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

const BOOKING_COLUMNS =
  "id, reference, status, source, check_in, check_out, adults, children, guest_id, guest_name, guest_email, guest_phone, guest_country, locale, special_requests, total_cents, price_breakdown, rules_snapshot, created_at, confirmed_at, cancelled_at";

const PAYMENT_COLUMNS =
  "id, booking_id, kind, method, status, amount_cents, note, paid_at, created_at";

const REFUND_COLUMNS =
  "id, booking_id, payment_id, amount_cents, status, reason, created_at";

const EXTERNAL_COLUMNS =
  "id, start_date, end_date, summary, guest_name, guest_email, guest_phone, guest_notes, amount_cents, created_at, external_calendars ( channel ), inventory_claims ( is_conflicted )";

type ExternalRow = Omit<ExternalInput, "channel" | "is_conflicted"> & {
  external_calendars: { channel: ExternalInput["channel"] } | null;
  inventory_claims:
    { is_conflicted: boolean } | { is_conflicted: boolean }[] | null;
};

function toExternalStay(row: ExternalRow, admin: AdminContext): Stay {
  const claim = [row.inventory_claims].flat()[0];
  return stayFromExternal({
    ...row,
    // Staff work with these bookings but the amount is the Owner's.
    amount_cents: admin.role === "owner" ? row.amount_cents : null,
    channel: row.external_calendars?.channel ?? "other_ical",
    is_conflicted: claim?.is_conflicted ?? false,
  });
}

export async function loadPayments(admin: AdminContext): Promise<PaymentRow[]> {
  return readAll<PaymentRow>((from, to) =>
    admin.supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .order("id")
      .range(from, to),
  );
}

export async function loadRefunds(admin: AdminContext): Promise<RefundRow[]> {
  return readAll<RefundRow>((from, to) =>
    admin.supabase
      .from("refunds")
      .select(REFUND_COLUMNS)
      .order("id")
      .range(from, to),
  );
}

export interface StayBook {
  stays: Stay[];
  payments: PaymentRow[];
  refunds: RefundRow[];
}

/** Every stay at the house. One house makes for a short list. */
export async function loadStayBook(admin: AdminContext): Promise<StayBook> {
  const [bookings, payments, refunds, events] = await Promise.all([
    readAll((from, to) =>
      admin.supabase
        .from("bookings")
        .select(BOOKING_COLUMNS)
        .order("id")
        .range(from, to),
    ),
    loadPayments(admin),
    loadRefunds(admin),
    readAll<ExternalRow>(
      (from, to) =>
        admin.supabase
          .from("external_events")
          .select(EXTERNAL_COLUMNS)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{
          data: ExternalRow[] | null;
          error: unknown;
        }>,
    ),
  ]);

  const paymentsOf = Map.groupBy(payments, (row) => row.booking_id);
  const refundsOf = Map.groupBy(refunds, (row) => row.booking_id);
  return {
    stays: [
      ...bookings.map((row) =>
        stayFromBooking(
          row,
          paymentsOf.get(row.id) ?? [],
          refundsOf.get(row.id) ?? [],
        ),
      ),
      ...events.map((row) => toExternalStay(row, admin)),
    ],
    payments,
    refunds,
  };
}

export async function loadBlocks(
  admin: AdminContext,
): Promise<CalendarBlock[]> {
  const rows = await readAll((from, to) =>
    admin.supabase
      .from("availability_blocks")
      .select("id, start_date, end_date, reason, note")
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({
    id: row.id,
    start: row.start_date,
    end: row.end_date,
    reason: row.reason,
    note: row.note,
  }));
}

/** Payments and refunds on the day the money moved. */
export function toReportInput(
  book: StayBook,
  blocks: CalendarBlock[],
  now: Date,
): ReportInput {
  const payments: MoneyMove[] = book.payments.map((row) => ({
    bookingId: row.booking_id,
    amountCents: row.amount_cents,
    status: row.status,
    at: row.paid_at ?? row.created_at,
  }));
  const refunds: MoneyMove[] = book.refunds.map((row) => ({
    bookingId: row.booking_id,
    amountCents: row.amount_cents,
    status: row.status,
    at: row.created_at,
  }));
  return {
    stays: book.stays,
    payments,
    refunds,
    blocks,
    today: athensDate(now),
  };
}

export async function loadBooking(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("bookings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadBookingMoney(admin: AdminContext, id: string) {
  const [payments, refunds] = await Promise.all([
    admin.supabase
      .from("payments")
      .select(PAYMENT_COLUMNS)
      .eq("booking_id", id)
      .order("created_at"),
    admin.supabase
      .from("refunds")
      .select(REFUND_COLUMNS)
      .eq("booking_id", id)
      .order("created_at"),
  ]);
  if (payments.error) throw payments.error;
  if (refunds.error) throw refunds.error;
  return { payments: payments.data, refunds: refunds.data };
}

export async function loadExternalStay(
  admin: AdminContext,
  id: string,
): Promise<Stay | null> {
  const { data, error } = await admin.supabase
    .from("external_events")
    .select(EXTERNAL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toExternalStay(data as unknown as ExternalRow, admin) : null;
}

export interface SentMessage {
  id: string;
  recipient: string;
  status: string;
  subject: string;
  body: string;
  createdAt: string;
}

function toSentMessage(row: {
  id: string;
  recipient: string;
  status: string;
  created_at: string;
  payload: unknown;
}): SentMessage {
  const payload = (row.payload ?? {}) as { subject?: unknown; body?: unknown };
  return {
    id: row.id,
    recipient: row.recipient,
    status: row.status,
    subject: typeof payload.subject === "string" ? payload.subject : "",
    body: typeof payload.body === "string" ? payload.body : "",
    createdAt: row.created_at,
  };
}

const EMAIL_COLUMNS = "id, recipient, status, created_at, payload";

export async function loadBookingEmails(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("email_logs")
    .select(EMAIL_COLUMNS)
    .eq("booking_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toSentMessage);
}

export async function loadExternalEmails(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("email_logs")
    .select(EMAIL_COLUMNS)
    .eq("payload->>external_event_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toSentMessage);
}

export async function loadContactEmails(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("email_logs")
    .select(EMAIL_COLUMNS)
    .eq("contact_message_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(toSentMessage);
}

const MESSAGE_COLUMNS =
  "id, name, email, phone, dates_of_interest, message, locale, booking_id, status, is_read, created_at";

export async function loadMessages(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("contact_messages")
    .select(MESSAGE_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

export async function loadMessage(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("contact_messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function countUnread(admin: AdminContext): Promise<number> {
  const { count, error } = await admin.supabase
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("is_read", false)
    .neq("status", "archived");
  if (error) throw error;
  return count ?? 0;
}

export async function loadMessagesForBooking(
  admin: AdminContext,
  bookingId: string,
  email: string | null,
) {
  const all = await loadMessages(admin);
  const wanted = email?.toLowerCase();
  return all.filter(
    (row) =>
      row.booking_id === bookingId ||
      (wanted && row.email.toLowerCase() === wanted),
  );
}

export interface HistoryEntry {
  id: string;
  action: string;
  entity: string;
  at: string;
  actor: string | null;
  after: Record<string, unknown> | null;
}

/** The audit log is the Owner's, so Staff get an empty list from the database. */
export async function loadHistory(
  admin: AdminContext,
  bookingId: string,
  moneyIds: string[],
): Promise<HistoryEntry[]> {
  if (admin.role !== "owner") return [];
  const { data, error } = await admin.supabase
    .from("audit_log")
    .select("id, action, entity, entity_id, actor_id, after, created_at")
    .in("entity_id", [bookingId, ...moneyIds])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const actorIds = [
    ...new Set(data.flatMap((row) => (row.actor_id ? [row.actor_id] : []))),
  ];
  const { data: names, error: nameError } = actorIds.length
    ? await admin.supabase
        .from("admin_profiles")
        .select("id, display_name")
        .in("id", actorIds)
    : { data: [], error: null };
  if (nameError) throw nameError;
  const nameOf = new Map(names?.map((row) => [row.id, row.display_name]));

  return data.map((row) => ({
    id: String(row.id),
    action: row.action,
    entity: row.entity,
    at: row.created_at,
    actor: row.actor_id ? (nameOf.get(row.actor_id) ?? null) : null,
    after: row.after as Record<string, unknown> | null,
  }));
}

export async function loadCalendarAlerts(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("external_calendars")
    .select("channel, is_enabled, consecutive_failures");
  if (error) throw error;
  return data.filter((row) => row.is_enabled && row.consecutive_failures > 0);
}
