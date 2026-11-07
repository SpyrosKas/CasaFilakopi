import type { AdminStrings } from "@/lib/admin/strings";
import type { Json } from "@/lib/db/types";
import { buildXlsx, type Cell, type Sheet } from "@/lib/invoicing/xlsx";

// A guest's data as an Excel file (CMP-02). Text stays text, so a guest called
// "=1+1" stays exactly that. Secrets never appear here: no token hash, and no
// email payloads, which can hold links.

export interface Identity {
  emails: string[];
  phones: string[];
  names: string[];
}

const digits = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");
const plain = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

/** The same rule the database uses to find someone's imported stays. */
export function isSamePerson(
  row: { email: string | null; phone: string | null; name: string | null },
  identity: Identity,
): boolean {
  const email = plain(row.email);
  const phone = digits(row.phone);
  const name = plain(row.name);
  return (
    (email !== "" && identity.emails.some((known) => plain(known) === email)) ||
    (phone !== "" &&
      identity.phones.some((known) => digits(known) === phone)) ||
    (name !== "" && identity.names.some((known) => plain(known) === name))
  );
}

export interface GuestDataExport {
  guest: {
    id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    country: string | null;
    locale: string;
    marketing_consent: boolean;
    created_at: string;
  } | null;
  identity: Identity;
  bookings: {
    reference: string | null;
    status: string;
    source: string;
    check_in: string;
    check_out: string;
    adults: number;
    children: number;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    guest_country: string | null;
    arrival_time: string | null;
    special_requests: string | null;
    internal_notes: string | null;
    cancellation_reason: string | null;
    total_cents: number;
    created_at: string;
  }[];
  payments: {
    kind: string;
    method: string;
    status: string;
    amount_cents: number;
    note: string | null;
    paid_at: string | null;
  }[];
  refunds: {
    amount_cents: number;
    status: string;
    reason: string | null;
    created_at: string;
  }[];
  invoices: {
    document_number: string | null;
    doc_type: string;
    status: string;
    issued_at: string | null;
    total_cents: number;
    customer: Json;
  }[];
  imported: {
    channel: string | null;
    start_date: string;
    end_date: string;
    summary: string | null;
    guest_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    guest_notes: string | null;
    amount_cents: number | null;
  }[];
  messages: {
    name: string;
    email: string;
    phone: string | null;
    dates_of_interest: string | null;
    message: string;
    created_at: string;
  }[];
  emails: {
    template_key: string;
    recipient: string;
    status: string;
    created_at: string;
    sent_at: string | null;
  }[];
  consents: {
    kind: string;
    policy_version: string | null;
    granted: boolean;
    created_at: string;
  }[];
}

const text = (value: string | null | undefined): Cell =>
  value ? { kind: "text", value } : { kind: "empty" };
const euro = (cents: number | null): Cell =>
  cents === null ? { kind: "empty" } : { kind: "euro", cents };
const count = (value: number): Cell => ({ kind: "count", value });
const date = (value: string | null): Cell =>
  value ? { kind: "date", value: value.slice(0, 10) } : { kind: "empty" };

interface Column<Row> {
  title: string;
  width: number;
  cell: (row: Row) => Cell;
}

function table<Row>(name: string, columns: Column<Row>[], rows: Row[]): Sheet {
  return {
    name,
    widths: columns.map((column) => column.width),
    freezeHeader: true,
    rows: [
      columns.map((column): Cell => ({
        kind: "text",
        value: column.title,
        style: "header",
      })),
      ...rows.map((row) => columns.map((column) => column.cell(row))),
    ],
  };
}

/** Whatever was printed on a document, as one readable line. */
function customerLine(customer: Json): string {
  if (customer === null || typeof customer !== "object") return "";
  return Object.values(customer)
    .filter((value) => typeof value === "string" && value !== "")
    .join(", ");
}

function guestSheet(data: GuestDataExport, t: AdminStrings): Sheet {
  const c = t.ops.privacy.columns;
  const s = t.ops.privacy.sheets;
  const { guest, identity } = data;
  const line = (field: string, value: string | null | undefined): Cell[] => [
    { kind: "text", value: field, style: "bold" },
    text(value),
  ];
  const yesNo = (value: boolean | undefined) =>
    value ? t.ops.privacy.yes : t.ops.privacy.no;
  return {
    name: s.guest,
    widths: [24, 48],
    rows: [
      [
        { kind: "text", value: c.field, style: "header" },
        { kind: "text", value: c.value, style: "header" },
      ],
      line(c.name, guest?.full_name ?? identity.names[0]),
      line(c.email, guest?.email ?? identity.emails[0]),
      line(c.phone, guest?.phone ?? identity.phones[0]),
      line(c.country, guest?.country),
      line(c.language, guest?.locale),
      line(c.marketing, yesNo(guest?.marketing_consent)),
      line(c.firstSeen, guest?.created_at.slice(0, 10)),
    ],
  };
}

export function guestWorkbook(
  data: GuestDataExport,
  t: AdminStrings,
): Uint8Array {
  const c = t.ops.privacy.columns;
  const s = t.ops.privacy.sheets;
  return buildXlsx([
    guestSheet(data, t),
    table(
      s.bookings,
      [
        { title: c.reference, width: 18, cell: (b) => text(b.reference) },
        { title: c.status, width: 14, cell: (b) => text(b.status) },
        { title: c.source, width: 12, cell: (b) => text(b.source) },
        { title: c.checkIn, width: 12, cell: (b) => date(b.check_in) },
        { title: c.checkOut, width: 12, cell: (b) => date(b.check_out) },
        { title: c.adults, width: 8, cell: (b) => count(b.adults) },
        { title: c.children, width: 9, cell: (b) => count(b.children) },
        { title: c.name, width: 24, cell: (b) => text(b.guest_name) },
        { title: c.email, width: 28, cell: (b) => text(b.guest_email) },
        { title: c.phone, width: 18, cell: (b) => text(b.guest_phone) },
        { title: c.country, width: 12, cell: (b) => text(b.guest_country) },
        { title: c.arrivalTime, width: 12, cell: (b) => text(b.arrival_time) },
        { title: c.requests, width: 36, cell: (b) => text(b.special_requests) },
        { title: c.notes, width: 36, cell: (b) => text(b.internal_notes) },
        {
          title: c.reason,
          width: 30,
          cell: (b) => text(b.cancellation_reason),
        },
        { title: c.total, width: 12, cell: (b) => euro(b.total_cents) },
        { title: c.created, width: 12, cell: (b) => date(b.created_at) },
      ],
      data.bookings,
    ),
    table(
      s.payments,
      [
        { title: c.kind, width: 12, cell: (p) => text(p.kind) },
        { title: c.method, width: 14, cell: (p) => text(p.method) },
        { title: c.status, width: 12, cell: (p) => text(p.status) },
        { title: c.amount, width: 12, cell: (p) => euro(p.amount_cents) },
        { title: c.paidOn, width: 12, cell: (p) => date(p.paid_at) },
        { title: c.notes, width: 36, cell: (p) => text(p.note) },
      ],
      data.payments,
    ),
    table(
      s.refunds,
      [
        { title: c.amount, width: 12, cell: (r) => euro(r.amount_cents) },
        { title: c.status, width: 12, cell: (r) => text(r.status) },
        { title: c.created, width: 12, cell: (r) => date(r.created_at) },
        { title: c.reason, width: 36, cell: (r) => text(r.reason) },
      ],
      data.refunds,
    ),
    table(
      s.invoices,
      [
        { title: c.number, width: 18, cell: (i) => text(i.document_number) },
        { title: c.type, width: 12, cell: (i) => text(i.doc_type) },
        { title: c.status, width: 10, cell: (i) => text(i.status) },
        { title: c.issued, width: 12, cell: (i) => date(i.issued_at) },
        { title: c.total, width: 12, cell: (i) => euro(i.total_cents) },
        {
          title: c.customer,
          width: 48,
          cell: (i) => text(customerLine(i.customer)),
        },
      ],
      data.invoices,
    ),
    table(
      s.imported,
      [
        { title: c.channel, width: 14, cell: (e) => text(e.channel) },
        { title: c.checkIn, width: 12, cell: (e) => date(e.start_date) },
        { title: c.checkOut, width: 12, cell: (e) => date(e.end_date) },
        { title: c.summary, width: 28, cell: (e) => text(e.summary) },
        { title: c.name, width: 24, cell: (e) => text(e.guest_name) },
        { title: c.email, width: 28, cell: (e) => text(e.guest_email) },
        { title: c.phone, width: 18, cell: (e) => text(e.guest_phone) },
        { title: c.notes, width: 36, cell: (e) => text(e.guest_notes) },
        { title: c.amount, width: 12, cell: (e) => euro(e.amount_cents) },
      ],
      data.imported,
    ),
    table(
      s.messages,
      [
        { title: c.received, width: 12, cell: (m) => date(m.created_at) },
        { title: c.name, width: 24, cell: (m) => text(m.name) },
        { title: c.email, width: 28, cell: (m) => text(m.email) },
        { title: c.phone, width: 18, cell: (m) => text(m.phone) },
        { title: c.dates, width: 24, cell: (m) => text(m.dates_of_interest) },
        { title: c.message, width: 60, cell: (m) => text(m.message) },
      ],
      data.messages,
    ),
    table(
      s.emails,
      [
        { title: c.created, width: 12, cell: (e) => date(e.created_at) },
        { title: c.template, width: 26, cell: (e) => text(e.template_key) },
        { title: c.email, width: 28, cell: (e) => text(e.recipient) },
        { title: c.status, width: 12, cell: (e) => text(e.status) },
        { title: c.sent, width: 12, cell: (e) => date(e.sent_at) },
      ],
      data.emails,
    ),
    table(
      s.consents,
      [
        { title: c.consent, width: 18, cell: (r) => text(r.kind) },
        {
          title: c.given,
          width: 8,
          cell: (r) => text(r.granted ? t.ops.privacy.yes : t.ops.privacy.no),
        },
        { title: c.policy, width: 16, cell: (r) => text(r.policy_version) },
        { title: c.created, width: 12, cell: (r) => date(r.created_at) },
      ],
      data.consents,
    ),
  ]);
}
