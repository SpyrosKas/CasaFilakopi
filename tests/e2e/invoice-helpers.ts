import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { pdfStoragePath } from "@/lib/invoicing/format";
import { renderInvoicePdf } from "@/lib/invoicing/pdf";
import { parseCustomer, parseIssuer } from "@/lib/invoicing/types";
import { db } from "./admin-helpers";

// Everything these tests make is theirs: their own room, far-future stays and
// far-future issue months, so a whole-month action can never reach documents
// from another test. All of it is removed at the end. Issued documents refuse
// deletion by design, so clean-up and backdating switch triggers off for one
// transaction, which only works with the local database's own login.

export const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
).storage.from("invoices");

const created = {
  bookings: [] as string[],
  series: [] as string[],
  paths: [] as string[],
  emails: [] as string[],
  roomId: "",
  settings: false,
};

const BREAKDOWN = {
  currency: "EUR",
  nights: [],
  totalCents: 42800,
  dueNowCents: 42800,
  balanceCents: 0,
  balanceDueOn: null,
  promoCode: null,
  lines: [
    {
      kind: "accommodation",
      label: { en: "Accommodation", el: "Διαμονή" },
      quantity: 2,
      unitCents: 20000,
      totalCents: 40000,
    },
    {
      kind: "cleaning",
      label: { en: "Cleaning fee", el: "Τέλος καθαρισμού" },
      quantity: 1,
      unitCents: 2400,
      totalCents: 2400,
    },
    {
      kind: "fee",
      label: { en: "Climate resilience fee", el: "Τέλος ανθεκτικότητας" },
      quantity: 2,
      unitCents: 200,
      totalCents: 400,
    },
  ],
};

export const BOOKING_TOTAL = BREAKDOWN.totalCents;

/** 864,00 of house charges, 13% VAT 112,32 and a 15,00 fee. */
export const VAT_BREAKDOWN = {
  ...BREAKDOWN,
  totalCents: 99132,
  dueNowCents: 99132,
  lines: [
    {
      kind: "accommodation",
      label: { en: "Accommodation", el: "Διαμονή" },
      quantity: 5,
      unitCents: 18000,
      totalCents: 90000,
    },
    {
      kind: "discount",
      label: { en: "Discount", el: "Έκπτωση" },
      quantity: 1,
      unitCents: -3600,
      totalCents: -3600,
    },
    {
      kind: "vat",
      label: { en: "VAT", el: "ΦΠΑ" },
      quantity: 1,
      unitCents: 11232,
      totalCents: 11232,
    },
    {
      kind: "fee",
      label: { en: "Climate resilience fee", el: "Τέλος ανθεκτικότητας" },
      quantity: 5,
      unitCents: 300,
      totalCents: 1500,
    },
  ],
};

export const DUMMY_ISSUER = {
  legalName: "DUMMY Business Name",
  vatNumber: "000000000",
  taxOffice: "DUMMY Tax Office",
  address: "Dummy Street 1, 84800 Milos",
  phone: "+30 000 000 0000",
  email: "host@miloscasa.com",
};

/** Works with or without the seed. Only adds what is missing. */
export async function ensureInvoicing(): Promise<void> {
  const inserted = await db.query(
    `insert into public.settings (key, value) values ('invoicing', $1::jsonb)
     on conflict (key) do nothing`,
    [
      JSON.stringify({
        isProvisional: true,
        defaultDocType: "receipt",
        myDataMode: "off",
        issuer: DUMMY_ISSUER,
      }),
    ],
  );
  created.settings = inserted.rowCount === 1;
  for (const type of ["receipt", "invoice", "credit_note"]) {
    const { rows } = await db.query(
      `insert into public.invoice_series (doc_type, prefix)
       select $1::public.invoice_doc_type, $2
       where not exists (
         select 1 from public.invoice_series
         where doc_type = $1::public.invoice_doc_type and is_active
       ) returning id`,
      [type, `ZE-${type}-${randomUUID().slice(0, 8)}`],
    );
    created.series.push(...rows.map((row) => row.id as string));
  }

  created.roomId = randomUUID();
  await db.query(
    `insert into public.rooms (id, slug, name, max_adults, base_occupancy, base_price_cents)
     values ($1, $2, '{"en":"Invoice test"}', 4, 2, 10000)`,
    [created.roomId, `invoice-e2e-${created.roomId}`],
  );
}

let stayDay = 0;

export interface PaidBooking {
  bookingId: string;
  reference: string;
  paymentId: string;
  intent: string;
  guest: string;
}

/** A confirmed booking with its payment, made through the real functions. */
export async function paidBooking(
  options: {
    guest?: string;
    kind?: "full" | "deposit";
    amountCents?: number;
    method?: string;
    breakdown?: { totalCents: number };
  } = {},
): Promise<PaidBooking> {
  const breakdown = options.breakdown ?? BREAKDOWN;
  stayDay += 3;
  const start = new Date(Date.UTC(2041, 0, stayDay));
  const end = new Date(Date.UTC(2041, 0, stayDay + 2));
  const guest = options.guest ?? `Δοκιμή ${randomUUID().slice(0, 8)}`;
  const email = `invoice-e2e-${randomUUID()}@example.test`;
  created.emails.push(email);
  const { rows } = await db.query(
    `select public.create_manual_booking(
       $1, $2::date, $3::date, 2, 0, $4::jsonb, $5::jsonb, $6,
       '{"payment":{"mode":"full"}}'::jsonb
     ) as r`,
    [
      created.roomId,
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
      JSON.stringify({
        name: guest,
        email,
        country: "GR",
      }),
      JSON.stringify(breakdown),
      breakdown.totalCents,
    ],
  );
  const { booking_id: bookingId, reference } = rows[0].r;
  created.bookings.push(bookingId);

  const intent = `pi_e2e_${randomUUID()}`;
  const paymentId = await addPayment(
    bookingId,
    options.kind ?? "full",
    options.amountCents ?? breakdown.totalCents,
    intent,
    options.method,
  );
  return { bookingId, reference, paymentId, intent, guest };
}

export async function addPayment(
  bookingId: string,
  kind: string,
  amountCents: number,
  intent = `pi_e2e_${randomUUID()}`,
  method = "card",
): Promise<string> {
  const { rows } = await db.query(
    `select public.record_payment($1, $2::public.payment_kind,
       $3::public.payment_method, $4, $5, 'free text note, ref 7') as id`,
    [bookingId, kind, method, amountCents, intent],
  );
  return rows[0].id;
}

/** Cancels a booking, leaving part or all of a payment refunded. */
export async function cancelWithRefund(
  booking: PaidBooking,
  refundCents: number,
): Promise<void> {
  await db.query(`select public.cancel_booking($1, 'Test')`, [
    booking.bookingId,
  ]);
  await db.query(
    `insert into public.refunds (booking_id, payment_id, amount_cents, status)
     values ($1, $2, $3, 'succeeded')`,
    [booking.bookingId, booking.paymentId, refundCents],
  );
}

export async function setStatus(bookingId: string, status: string) {
  await db.query(
    `update public.bookings set status = $1::public.booking_status where id = $2`,
    [status, bookingId],
  );
}

export async function setBreakdown(bookingId: string, breakdown: unknown) {
  await db.query(
    `update public.bookings set price_breakdown = $1::jsonb where id = $2`,
    [JSON.stringify(breakdown), bookingId],
  );
}

export interface Fixture extends PaidBooking {
  id: string;
  number: string;
  pdfPath: string | null;
}

/**
 * A document issued straight through the database function, then moved into a
 * month of its own, with or without its stored PDF.
 */
export async function issuedDocument(
  month: string,
  options: { withPdf?: boolean; guest?: string; number?: string } = {},
): Promise<Fixture> {
  const booking = await paidBooking({ guest: options.guest });
  const lines = [
    {
      description: "Διαμονή / Accommodation",
      quantity: 1,
      unitCents: BOOKING_TOTAL,
      totalCents: BOOKING_TOTAL,
      kind: "accommodation",
    },
  ];
  const { rows } = await db.query(
    `select public.issue_invoice(
       $1, 'receipt', $2::jsonb, $3::jsonb, $4, 'card'
     ) as r`,
    [
      booking.bookingId,
      JSON.stringify({ name: booking.guest }),
      JSON.stringify(lines),
      booking.paymentId,
    ],
  );
  const id: string = rows[0].r.invoice_id;
  const issuedAt = `${month}-15T10:00:00.000Z`;
  const number: string = options.number ?? rows[0].r.document_number;
  await withoutTriggers(async (client) => {
    await client.query(
      `update public.invoices set issued_at = $1, document_number = $2
       where id = $3`,
      [issuedAt, number, id],
    );
  });
  if (options.withPdf === false) {
    return { ...booking, id, number, pdfPath: null };
  }

  const { rows: stored } = await db.query(
    `select issuer from public.invoices where id = $1`,
    [id],
  );
  const bytes = await renderInvoicePdf({
    documentNumber: number,
    docType: "receipt",
    issuedAt,
    isProvisional: true,
    issuer: parseIssuer(stored[0].issuer),
    customer: parseCustomer({ name: booking.guest }),
    lines: lines.map((line) => ({
      ...line,
      vatCents: 0,
      vatBasisPoints: 0,
      kind: "accommodation" as const,
    })),
    netCents: BOOKING_TOTAL,
    vatCents: 0,
    feeCents: 0,
    totalCents: BOOKING_TOTAL,
    paymentMethod: "card",
    bookingReference: booking.reference,
    creditsDocumentNumber: null,
    reason: null,
  });
  const path = pdfStoragePath(id, issuedAt);
  const { error } = await storage.upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
  created.paths.push(path);
  await db.query(`select public.attach_invoice_pdf($1, $2)`, [id, path]);
  return { ...booking, id, number, pdfPath: path };
}

async function withoutTriggers(
  work: (client: { query: typeof db.query }) => Promise<void>,
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`set local session_replication_role = replica`);
    await work(client as unknown as { query: typeof db.query });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Issued rows made in bulk, for testing the selection limit. */
export async function bulkDocuments(
  month: string,
  count: number,
): Promise<void> {
  const booking = await paidBooking();
  const series = randomUUID();
  created.series.push(series);
  await withoutTriggers(async (client) => {
    await client.query(
      `insert into public.invoice_series (id, doc_type, prefix, is_active)
       values ($1, 'receipt', $2, false)`,
      [series, `ZB-${series.slice(0, 8)}`],
    );
    await client.query(
      `insert into public.invoices (
         booking_id, series_id, number, document_number, doc_type, status,
         issued_at, total_cents
       )
       select $1, $2, n, $5 || '-' || n, 'receipt', 'issued',
         $3::timestamptz, 100
       from generate_series(1, $4::int) n`,
      [
        booking.bookingId,
        series,
        `${month}-15T10:00:00Z`,
        count,
        `ZB-${series}`,
      ],
    );
  });
}

export async function cleanUpInvoices(): Promise<void> {
  const { rows } = await db.query(
    `select pdf_path from public.invoices
     where booking_id = any($1::uuid[]) and pdf_path is not null`,
    [created.bookings],
  );
  const paths = [
    ...new Set([
      ...created.paths,
      ...rows.map((row) => row.pdf_path as string),
    ]),
  ];
  if (paths.length) await storage.remove(paths);

  await withoutTriggers(async (client) => {
    const ids = [created.bookings];
    await client.query(
      `delete from public.invoice_lines where invoice_id in (
         select id from public.invoices where booking_id = any($1::uuid[])
       )`,
      ids,
    );
    await client.query(
      `delete from public.invoices where booking_id = any($1::uuid[])
         and credits_invoice_id is not null`,
      ids,
    );
    await client.query(
      `delete from public.invoices where booking_id = any($1::uuid[])`,
      ids,
    );
    await client.query(
      `delete from public.refunds where booking_id = any($1::uuid[])`,
      ids,
    );
    await client.query(
      `delete from public.payments where booking_id = any($1::uuid[])`,
      ids,
    );
    await client.query(
      `delete from public.inventory_claims where booking_id = any($1::uuid[])`,
      ids,
    );
    await client.query(
      `delete from public.bookings where id = any($1::uuid[])`,
      ids,
    );
    await client.query(`delete from public.rooms where id = $1`, [
      created.roomId,
    ]);
    await client.query(
      `delete from public.invoice_series where id = any($1::uuid[])`,
      [created.series],
    );
  });
  // Only this spec's own: another may be running with bookings of its own.
  await db.query(`delete from public.guests where email = any($1::text[])`, [
    created.emails,
  ]);
  if (created.settings) {
    await db.query(`delete from public.settings where key = 'invoicing'`);
  }
}

export async function invoiceRow(id: string) {
  const { rows } = await db.query(
    `select * from public.invoices where id = $1`,
    [id],
  );
  return rows[0];
}

/** A far-future month nothing else uses, different for every run. */
export function freshMonth(offset: number): string {
  const salt = parseInt(randomUUID().slice(0, 4), 16) % 600;
  const months = 12 * 2050 + salt + offset;
  const year = Math.floor(months / 12);
  return `${year}-${String((months % 12) + 1).padStart(2, "0")}`;
}
