import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Database } from "@/lib/db/types";
import { athensDate, addMonths } from "@/lib/domain/dates";
import { documentNumber, pdfStoragePath } from "@/lib/invoicing/format";
import { buildCreditLines, buildPaymentLines } from "@/lib/invoicing/lines";
import { renderInvoicePdf } from "@/lib/invoicing/pdf";
import {
  isLocalUrl,
  seedRefusal,
  setupRefusal,
} from "@/lib/invoicing/seed-guard";
import {
  invoicingSettingsSchema,
  isDummyIssuer,
} from "@/lib/invoicing/settings";
import {
  parseCustomer,
  parseIssuer,
  type DocType,
  type DocumentLine,
  type LineKind,
  type PaymentKind,
  type PaymentMethod,
} from "@/lib/invoicing/types";

// Demo invoices for local and staging. Run it with:
//   pnpm seed:invoices            (local)
//   pnpm seed:invoices --staging  (staging)
// Every guest is fake and every email is @example.test. Stays are in 2035, so
// no real dates are blocked. Documents can never be deleted, so run it once.
//
// The issue date always comes from the database clock. On a local database the
// script moves documents back to spread them over six months, so the month
// filter has something to show. On staging they all carry today's date.

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DEMO_EMAIL = "demo-guest-%@example.test";

interface Plan {
  guest: string;
  monthsAgo: number;
  doc: "receipt" | "invoice";
  method: PaymentMethod;
  split?: boolean;
  credit?: "full" | "part";
}

const PLANS: Plan[] = [
  { guest: "Demo Guest Άλφα", monthsAgo: 5, doc: "receipt", method: "card" },
  { guest: "Demo Guest Beta", monthsAgo: 5, doc: "invoice", method: "card" },
  {
    guest: "Demo Guest Γάμμα",
    monthsAgo: 4,
    doc: "receipt",
    method: "card",
    split: true,
  },
  {
    guest: "Demo Guest Delta",
    monthsAgo: 4,
    doc: "receipt",
    method: "bank_transfer",
    credit: "full",
  },
  { guest: "Demo Guest Έψιλον", monthsAgo: 3, doc: "invoice", method: "card" },
  { guest: "Demo Guest Zeta", monthsAgo: 3, doc: "receipt", method: "cash" },
  {
    guest: "Demo Guest Ήτα",
    monthsAgo: 2,
    doc: "receipt",
    method: "card",
    credit: "part",
  },
  {
    guest: "Demo Guest Theta",
    monthsAgo: 2,
    doc: "invoice",
    method: "bank_transfer",
    split: true,
  },
  { guest: "Demo Guest Ιώτα", monthsAgo: 1, doc: "receipt", method: "pos" },
  { guest: "Demo Guest Kappa", monthsAgo: 1, doc: "receipt", method: "card" },
  {
    guest: "Demo Guest Λάμδα",
    monthsAgo: 0,
    doc: "invoice",
    method: "card",
    credit: "part",
  },
  { guest: "Demo Guest Mu", monthsAgo: 0, doc: "receipt", method: "card" },
];

const RULES = {
  payment: { mode: "full", deposit: null, balanceDaysBefore: 0 },
  cancellation: { isNonRefundable: false, tiers: [] },
  capturedAt: "2026-11-07T00:00:00.000Z",
};

function breakdownFor(nights: number) {
  const lines = [
    {
      kind: "accommodation",
      label: { en: "Accommodation", el: "Διαμονή" },
      quantity: nights,
      unitCents: 18000,
      totalCents: 18000 * nights,
    },
    {
      kind: "cleaning",
      label: { en: "Cleaning fee", el: "Τέλος καθαρισμού" },
      quantity: 1,
      unitCents: 4000,
      totalCents: 4000,
    },
    {
      kind: "fee",
      label: {
        en: "Climate resilience fee",
        el: "Τέλος ανθεκτικότητας στην κλιματική κρίση",
      },
      quantity: nights,
      unitCents: 200,
      totalCents: 200 * nights,
    },
  ];
  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  return {
    currency: "EUR",
    nights: [],
    lines,
    totalCents,
    dueNowCents: totalCents,
    balanceCents: 0,
    balanceDueOn: null,
    promoCode: null,
  };
}

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  process.loadEnvFile(".env.local");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const refused = seedRefusal({
    supabaseUrl,
    names: [
      process.env.NODE_ENV,
      process.env.VERCEL_ENV,
      process.env.APP_ENV,
      process.env.SUPABASE_PROJECT_NAME,
    ],
    stagingFlag: process.argv.includes("--staging"),
  });
  if (refused) stop(refused);

  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const db = createClient<Database>(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function rpc<T = unknown>(name: string, args: object): Promise<T> {
    const { data, error } = await (
      db.rpc as unknown as (
        fn: string,
        params: object,
      ) => PromiseLike<{ data: T; error: { message: string } | null }>
    )(name, args);
    if (error) stop(`${name} failed: ${error.message}`);
    return data;
  }

  const { data: setting } = await db
    .from("settings")
    .select("value")
    .eq("key", "invoicing")
    .maybeSingle();
  const settings = invoicingSettingsSchema.parse(setting?.value ?? {});
  const unsafe = setupRefusal({
    isStored: setting !== null,
    isProvisional: settings.isProvisional,
    isDummy: isDummyIssuer(settings.issuer),
  });
  if (unsafe) stop(unsafe);

  const slug = process.env.SEED_ROOM_SLUG ?? "casa-filakopi";
  const { data: room } = await db
    .from("rooms")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!room) stop(`No room with the slug "${slug}".`);

  const { count } = await db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .like("guest_email", DEMO_EMAIL);
  if (count)
    stop(`Already seeded: ${count} demo bookings exist. Nothing done.`);

  const backdater = isLocalUrl(supabaseUrl)
    ? new pg.Client({ connectionString: LOCAL_DB })
    : null;
  await backdater?.connect();
  await backdater?.query(`set session_replication_role = replica`);

  async function finish(invoiceId: string, issuedAt: string | null) {
    if (issuedAt) {
      await backdater?.query(
        `update public.invoices set issued_at = $1 where id = $2`,
        [issuedAt, invoiceId],
      );
    }
    const { data: row, error } = await db
      .from("invoices")
      .select("*, invoice_series ( prefix ), bookings ( reference )")
      .eq("id", invoiceId)
      .single();
    if (error) stop(error.message);
    const { data: lineRows } = await db
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("sort_order");
    const lines: DocumentLine[] = (lineRows ?? []).map((line) => ({
      description: line.description,
      quantity: Number(line.quantity),
      unitCents: line.unit_cents,
      totalCents: line.total_cents,
      vatCents: line.vat_cents,
      vatBasisPoints: line.vat_basis_points,
      kind: line.kind as LineKind,
    }));

    let creditsDocumentNumber: string | null = null;
    if (row.credits_invoice_id) {
      const { data: original } = await db
        .from("invoices")
        .select("number, invoice_series ( prefix )")
        .eq("id", row.credits_invoice_id)
        .single();
      creditsDocumentNumber = original
        ? documentNumber(
            original.invoice_series?.prefix ?? "",
            original.number ?? 0,
          )
        : null;
    }

    const number = documentNumber(
      row.invoice_series?.prefix ?? "",
      row.number ?? 0,
    );
    const bytes = await renderInvoicePdf({
      documentNumber: number,
      docType: row.doc_type as DocType,
      issuedAt: row.issued_at ?? "",
      isProvisional: row.is_provisional,
      issuer: parseIssuer(row.issuer),
      customer: parseCustomer(row.customer),
      lines,
      netCents: row.net_cents,
      vatCents: row.vat_cents,
      feeCents: row.fee_cents,
      totalCents: row.total_cents,
      paymentMethod: row.payment_method,
      bookingReference: row.bookings?.reference ?? "",
      creditsDocumentNumber,
      reason: row.reason,
    });
    const path = pdfStoragePath(number, row.issued_at ?? "");
    const { error: uploadError } = await db.storage
      .from("invoices")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) stop(uploadError.message);
    await rpc("attach_invoice_pdf", { p_invoice_id: invoiceId, p_path: path });
    return { number, lines, total: row.total_cents, vat: row.vat_cents };
  }

  const today = athensDate(new Date());
  let issued = 0;

  for (const [index, plan] of PLANS.entries()) {
    const number = String(index + 1).padStart(2, "0");
    const nights = 3 + (index % 5);
    const checkIn = `2035-${String(1 + index).padStart(2, "0")}-05`;
    const checkOut = `2035-${String(1 + index).padStart(2, "0")}-${String(5 + nights).padStart(2, "0")}`;
    const breakdown = breakdownFor(nights);
    const total = breakdown.totalCents;

    const booking = await rpc<{ booking_id: string; reference: string }>(
      "create_manual_booking",
      {
        p_room_id: room.id,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_adults: 2,
        p_children: 0,
        p_guest: {
          name: plan.guest,
          email: `demo-guest-${number}@example.test`,
          country: "GR",
          locale: "el",
        },
        p_price_breakdown: breakdown,
        p_total_cents: total,
        p_rules_snapshot: RULES,
        p_internal_notes: "Demo data, not a real booking.",
      },
    );

    const deposit = Math.round(total * 0.3);
    const payments: { kind: PaymentKind; amount: number }[] = plan.split
      ? [
          { kind: "deposit", amount: deposit },
          { kind: "balance", amount: total - deposit },
        ]
      : [{ kind: "full", amount: total }];

    const issuedAt = backdater
      ? `${addMonths(today, -plan.monthsAgo).slice(0, 7)}-15T10:00:00Z`
      : null;

    for (const [part, payment] of payments.entries()) {
      const paymentId = await rpc<string>("record_payment", {
        p_booking_id: booking.booking_id,
        p_kind: payment.kind,
        p_method: plan.method,
        p_amount_cents: payment.amount,
        p_payment_intent_id: `pi_demo_${number}_${part}`,
        p_note: `demo-ref-${number}-${part}`,
      });

      const { lines } = buildPaymentLines({
        reference: booking.reference,
        breakdown,
        payment: { kind: payment.kind, amountCents: payment.amount },
      });
      const result = await rpc<{ invoice_id: string }>("issue_invoice", {
        p_booking_id: booking.booking_id,
        p_doc_type: plan.doc,
        p_customer:
          plan.doc === "invoice"
            ? {
                name: plan.guest,
                email: `demo-guest-${number}@example.test`,
                companyName: `DEMO Εταιρεία ${number} Α.Ε.`,
                vatNumber: `0000000${number}`,
                address: "Οδός Δοκιμής 1, Αθήνα",
                taxOffice: "DEMO ΔΟΥ",
              }
            : {
                name: plan.guest,
                email: `demo-guest-${number}@example.test`,
                country: "GR",
              },
        p_lines: lines,
        p_payment_id: paymentId,
        p_payment_method: plan.method,
      });
      const document = await finish(result.invoice_id, issuedAt);
      issued += 1;

      if (plan.credit && part === 0) {
        const amountCents =
          plan.credit === "full" ? document.total : Math.round(total * 0.2);
        const credit = await rpc<{ invoice_id: string }>("issue_credit_note", {
          p_invoice_id: result.invoice_id,
          p_lines: buildCreditLines({
            documentNumber: document.number,
            totalCents: document.total,
            vatCents: document.vat,
            lines: document.lines,
            creditedCents: 0,
            creditedVatCents: 0,
            amountCents,
          }),
          p_reason:
            plan.credit === "full"
              ? "Ακύρωση κράτησης (demo) / Booking cancelled (demo)"
              : "Μερική επιστροφή (demo) / Partial refund (demo)",
        });
        await finish(credit.invoice_id, issuedAt);
        issued += 1;
      }
    }
  }

  await backdater?.end();
  console.log(`Done: ${PLANS.length} demo bookings, ${issued} documents.`);
}

void main();
