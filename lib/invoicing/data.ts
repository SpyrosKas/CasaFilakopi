import "server-only";
import type { AdminContext } from "@/lib/admin/session";
import { documentNumber, issuedOn } from "./format";
import type { FilterableRow } from "./filters";
import type { PdfInput } from "./pdf";
import { invoicingSettingsSchema, type InvoicingSettings } from "./settings";
import {
  customerLabel,
  parseCustomer,
  parseIssuer,
  type Customer,
  type DocType,
  type DocumentLine,
  type Issuer,
  type LineKind,
  type PaymentKind,
  type PaymentMethod,
} from "./types";

// Reads go through the Owner's own client, so row security applies as well as
// the requireOwner check each page and action makes first.

const PAGE = 1000;

const INDEX_COLUMNS = `
  id, number, doc_type, issued_at, is_provisional, issuer, customer,
  booking_id, payment_id, payment_method, pdf_path, exported_at,
  credits_invoice_id, reason, total_cents, net_cents, vat_cents, fee_cents,
  invoice_series ( prefix ),
  bookings ( reference, guest_name ),
  payments ( stripe_payment_intent_id, stripe_checkout_session_id, note )
`;

export interface IndexRow extends FilterableRow {
  documentNumber: string;
  issuedAt: string;
  isProvisional: boolean;
  issuer: Issuer;
  customer: Customer;
  customerName: string;
  bookingId: string | null;
  paymentId: string | null;
  pdfPath: string | null;
  exportedAt: string | null;
  reason: string | null;
  creditsDocumentNumber: string | null;
}

interface RawRow {
  id: string;
  number: number | null;
  doc_type: DocType;
  issued_at: string | null;
  is_provisional: boolean;
  issuer: unknown;
  customer: unknown;
  booking_id: string | null;
  payment_id: string | null;
  payment_method: PaymentMethod | null;
  pdf_path: string | null;
  exported_at: string | null;
  credits_invoice_id: string | null;
  reason: string | null;
  total_cents: number;
  net_cents: number;
  vat_cents: number;
  fee_cents: number;
  invoice_series: { prefix: string } | null;
  bookings: { reference: string | null; guest_name: string | null } | null;
  payments: {
    stripe_payment_intent_id: string | null;
    stripe_checkout_session_id: string | null;
    note: string | null;
  } | null;
}

function toRow(raw: RawRow): IndexRow {
  const customer = parseCustomer(raw.customer);
  const guest = raw.bookings?.guest_name ?? "";
  const issuedAt = raw.issued_at ?? "";
  const number = documentNumber(
    raw.invoice_series?.prefix ?? "",
    raw.number ?? 0,
  );
  return {
    id: raw.id,
    documentNumber: number,
    docType: raw.doc_type,
    issuedAt,
    issuedOn: issuedOn(issuedAt),
    isProvisional: raw.is_provisional,
    issuer: parseIssuer(raw.issuer),
    customer,
    customerName: customerLabel(customer, guest),
    guestNames: [customer.name, customer.companyName, guest].filter(Boolean),
    bookingId: raw.booking_id,
    bookingReference: raw.bookings?.reference ?? "",
    paymentId: raw.payment_id,
    paymentMethod: raw.payment_method,
    transactionIds: [
      raw.payments?.stripe_payment_intent_id,
      raw.payments?.stripe_checkout_session_id,
      raw.payments?.note,
      raw.payment_id,
    ].filter((value): value is string => Boolean(value)),
    pdfPath: raw.pdf_path,
    hasPdf: raw.pdf_path !== null,
    exportedAt: raw.exported_at,
    isSent: raw.exported_at !== null,
    reason: raw.reason,
    creditsInvoiceId: raw.credits_invoice_id,
    creditsDocumentNumber: null,
    totalCents: raw.total_cents,
    netCents: raw.net_cents,
    vatCents: raw.vat_cents,
    feeCents: raw.fee_cents,
  };
}

/** Every issued document, newest first. See applyFilters for why all of them. */
export async function loadIndex(admin: AdminContext): Promise<IndexRow[]> {
  const raw: RawRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.supabase
      .from("invoices")
      .select(INDEX_COLUMNS)
      .eq("status", "issued")
      .order("issued_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    raw.push(...(data as unknown as RawRow[]));
    if (data.length < PAGE) break;
  }
  const rows = raw.map(toRow);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.creditsInvoiceId) {
      row.creditsDocumentNumber =
        byId.get(row.creditsInvoiceId)?.documentNumber ?? null;
    }
  }
  return rows;
}

export async function loadLines(
  admin: AdminContext,
  invoiceId: string,
): Promise<DocumentLine[]> {
  return (await loadLinesFor(admin, [invoiceId])).get(invoiceId) ?? [];
}

/** Asks in small groups, so a long list of ids still fits in one request. */
export async function loadLinesFor(
  admin: AdminContext,
  invoiceIds: string[],
): Promise<Map<string, DocumentLine[]>> {
  const lines = new Map<string, DocumentLine[]>();
  for (let start = 0; start < invoiceIds.length; start += 100) {
    const { data, error } = await admin.supabase
      .from("invoice_lines")
      .select(
        "invoice_id, description, quantity, unit_cents, total_cents, vat_cents, vat_basis_points, kind",
      )
      .in("invoice_id", invoiceIds.slice(start, start + 100))
      .order("sort_order");
    if (error) throw error;
    for (const line of data) {
      const list = lines.get(line.invoice_id) ?? [];
      list.push({
        description: line.description,
        quantity: Number(line.quantity),
        unitCents: line.unit_cents,
        totalCents: line.total_cents,
        vatCents: line.vat_cents,
        vatBasisPoints: line.vat_basis_points,
        kind: line.kind as LineKind,
      });
      lines.set(line.invoice_id, list);
    }
  }
  return lines;
}

export function pdfInput(row: IndexRow, lines: DocumentLine[]): PdfInput {
  return {
    documentNumber: row.documentNumber,
    docType: row.docType,
    issuedAt: row.issuedAt,
    isProvisional: row.isProvisional,
    issuer: row.issuer,
    customer: row.customer,
    lines,
    netCents: row.netCents,
    vatCents: row.vatCents,
    feeCents: row.feeCents,
    totalCents: row.totalCents,
    paymentMethod: row.paymentMethod as PaymentMethod | null,
    bookingReference: row.bookingReference,
    creditsDocumentNumber: row.creditsDocumentNumber,
    reason: row.reason,
  };
}

export interface PaymentDetails {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountCents: number;
  paidAt: string | null;
  stripePaymentIntentId: string | null;
  note: string | null;
}

export async function loadPayment(
  admin: AdminContext,
  id: string,
): Promise<PaymentDetails | null> {
  const { data, error } = await admin.supabase
    .from("payments")
    .select(
      "id, kind, method, amount_cents, paid_at, stripe_payment_intent_id, note",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (
    data && {
      id: data.id,
      kind: data.kind,
      method: data.method,
      amountCents: data.amount_cents,
      paidAt: data.paid_at,
      stripePaymentIntentId: data.stripe_payment_intent_id,
      note: data.note,
    }
  );
}

/** Bookings a document may be issued for, as this screen sees them. */
const ISSUABLE_BOOKINGS = ["confirmed", "checked_in", "completed"] as const;

export interface IssuablePayment {
  paymentId: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amountCents: number;
  paidAt: string | null;
  bookingId: string;
  reference: string;
  guestName: string;
  guestEmail: string;
  guestCountry: string;
  checkIn: string;
  checkOut: string;
  breakdown: unknown;
}

const ISSUABLE_COLUMNS = `
  id, kind, method, amount_cents, paid_at,
  bookings!inner (
    id, reference, status, guest_name, guest_email, guest_country,
    check_in, check_out, price_breakdown
  )
`;

interface RawIssuable {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount_cents: number;
  paid_at: string | null;
  bookings: {
    id: string;
    reference: string | null;
    guest_name: string | null;
    guest_email: string | null;
    guest_country: string | null;
    check_in: string;
    check_out: string;
    price_breakdown: unknown;
  };
}

function toIssuable(raw: RawIssuable): IssuablePayment {
  const booking = raw.bookings;
  return {
    paymentId: raw.id,
    kind: raw.kind,
    method: raw.method,
    amountCents: raw.amount_cents,
    paidAt: raw.paid_at,
    bookingId: booking.id,
    reference: booking.reference ?? "",
    guestName: booking.guest_name ?? "",
    guestEmail: booking.guest_email ?? "",
    guestCountry: booking.guest_country ?? "",
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    breakdown: booking.price_breakdown,
  };
}

/**
 * One row per paid payment with no document yet. A document is always tied to
 * a payment, because that is what lets the database refuse a second one.
 */
export async function loadIssuablePayments(
  admin: AdminContext,
): Promise<IssuablePayment[]> {
  const issued = new Set(
    (await loadIndex(admin)).flatMap((row) =>
      row.paymentId ? [row.paymentId] : [],
    ),
  );
  const raw: RawIssuable[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.supabase
      .from("payments")
      .select(ISSUABLE_COLUMNS)
      .eq("status", "succeeded")
      .in("bookings.status", ISSUABLE_BOOKINGS)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    raw.push(...(data as unknown as RawIssuable[]));
    if (data.length < PAGE) break;
  }
  return raw.filter((row) => !issued.has(row.id)).map(toIssuable);
}

export async function loadIssuablePayment(
  admin: AdminContext,
  paymentId: string,
): Promise<IssuablePayment | null> {
  const { data, error } = await admin.supabase
    .from("payments")
    .select(ISSUABLE_COLUMNS)
    .eq("id", paymentId)
    .eq("status", "succeeded")
    .in("bookings.status", ISSUABLE_BOOKINGS)
    .maybeSingle();
  if (error) throw error;
  return data ? toIssuable(data as unknown as RawIssuable) : null;
}

export interface InvoicingSetup {
  settings: InvoicingSettings;
  /** False when the setting has never been saved. */
  isStored: boolean;
  /** True when the stored setting could not be read as expected. */
  isUnreadable: boolean;
}

export async function loadInvoicingSetup(
  admin: AdminContext,
): Promise<InvoicingSetup> {
  const { data, error } = await admin.supabase
    .from("settings")
    .select("value")
    .eq("key", "invoicing")
    .maybeSingle();
  if (error) throw error;
  const parsed = invoicingSettingsSchema.safeParse(data?.value ?? {});
  return {
    settings: parsed.data ?? invoicingSettingsSchema.parse({}),
    isStored: data !== null,
    isUnreadable: !parsed.success,
  };
}

export async function loadActiveSeries(
  admin: AdminContext,
): Promise<{ docType: DocType; prefix: string }[]> {
  const { data, error } = await admin.supabase
    .from("invoice_series")
    .select("doc_type, prefix")
    .eq("is_active", true)
    .order("doc_type");
  if (error) throw error;
  return data.map((row) => ({ docType: row.doc_type, prefix: row.prefix }));
}
