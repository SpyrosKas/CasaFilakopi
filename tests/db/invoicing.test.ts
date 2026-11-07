import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anon,
  confirm,
  createAdmin,
  createHold,
  createRoom,
  db,
} from "./helpers";

const LINE = (totalCents: number, extra = {}) => ({
  description: "Accommodation",
  quantity: 1,
  unitCents: totalCents,
  totalCents,
  kind: "accommodation",
  ...extra,
});

const CUSTOMER = JSON.stringify({ name: "Test Guest" });

let roomId: string;
let day = 1;
let insertedSettings = false;

const paidBooking = async () => {
  const start = new Date(Date.UTC(2033, 0, day));
  const end = new Date(Date.UTC(2033, 0, day + 1));
  day += 2;
  const id = await createHold({
    roomId,
    checkIn: start.toISOString().slice(0, 10),
    checkOut: end.toISOString().slice(0, 10),
  });
  await confirm(id);
  const { rows } = await db.query(
    `select id from public.payments where booking_id = $1`,
    [id],
  );
  return { id, paymentId: rows[0].id as string };
};

const issue = async (
  bookingId: string,
  paymentId: string | null,
  lines: unknown[] = [LINE(10000)],
  docType = "receipt",
) =>
  (
    await db.query(
      `select public.issue_invoice($1, $2::public.invoice_doc_type, $3::jsonb, $4::jsonb, $5, 'card') as r`,
      [bookingId, docType, CUSTOMER, JSON.stringify(lines), paymentId],
    )
  ).rows[0].r as {
    invoice_id: string;
    number: number;
    document_number?: string;
    already_issued: boolean;
  };

const credited = async (id: string) =>
  (
    await db.query(
      `select coalesce(sum(total_cents), 0)::int as n from public.invoices
       where credits_invoice_id = $1`,
      [id],
    )
  ).rows[0].n as number;

const credit = async (
  id: string,
  cents: number,
  reason = "Refund",
  expected?: number,
) =>
  db.query(`select public.issue_credit_note($1, $2::jsonb, $3, $4) as r`, [
    id,
    JSON.stringify([LINE(cents)]),
    reason,
    expected ?? (await credited(id)),
  ]);

const invoice = async (id: string) =>
  (await db.query(`select * from public.invoices where id = $1`, [id])).rows[0];

beforeAll(async () => {
  roomId = await createRoom();
  const inserted = await db.query(
    `insert into public.settings (key, value) values ('invoicing', $1::jsonb)
     on conflict (key) do nothing`,
    [JSON.stringify({ isProvisional: true, issuer: { legalName: "Dummy" } })],
  );
  insertedSettings = inserted.rowCount === 1;
  // Uses the seeded series when present; a bare database gets its own.
  for (const type of ["receipt", "invoice", "credit_note"]) {
    await db.query(
      `insert into public.invoice_series (doc_type, prefix)
       select $1::public.invoice_doc_type, $2
       where not exists (
         select 1 from public.invoice_series
         where doc_type = $1::public.invoice_doc_type and is_active
       )`,
      [type, `ZT-${type}-${randomUUID().slice(0, 8)}`],
    );
  }
});

afterAll(async () => {
  if (insertedSettings) {
    await db.query(`delete from public.settings where key = 'invoicing'`);
  }
  await db.end();
});

describe("issuing", () => {
  it("issues a provisional document with totals from its lines", async () => {
    const { id, paymentId } = await paidBooking();
    const result = await issue(id, paymentId, [
      LINE(9000, { vatCents: 1000 }),
      LINE(1000, { kind: "fee", description: "Climate fee" }),
    ]);
    const row = await invoice(result.invoice_id);
    expect(row).toMatchObject({
      status: "issued",
      is_provisional: true,
      total_cents: 10000,
      vat_cents: 1000,
      fee_cents: 1000,
      net_cents: 8000,
      payment_id: paymentId,
    });
    expect(row.issuer.legalName).toBeTruthy();
  });

  it("a repeated payment gets the same document", async () => {
    const { id, paymentId } = await paidBooking();
    const first = await issue(id, paymentId);
    const second = await issue(id, paymentId);
    expect(second.invoice_id).toBe(first.invoice_id);
    expect(second.already_issued).toBe(true);
  });

  it("10 concurrent issues for one payment make one document", async () => {
    const { id, paymentId } = await paidBooking();
    await Promise.all(Array.from({ length: 10 }, () => issue(id, paymentId)));
    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where payment_id = $1`,
      [paymentId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("numbers stay gapless under concurrency and failures", async () => {
    const bookings = await Promise.all(
      Array.from({ length: 12 }, () => paidBooking()),
    );
    const results = await Promise.allSettled(
      bookings.map((b, i) =>
        i % 3 === 0
          ? issue(b.id, b.paymentId, []) // fails, no lines
          : issue(b.id, b.paymentId),
      ),
    );
    const numbers = results
      .flatMap((r) => (r.status === "fulfilled" ? [r.value.number] : []))
      .sort((a, b) => a - b);
    expect(numbers).toHaveLength(8);
    numbers.forEach((n, i) => expect(n).toBe(numbers[0] + i));
  });

  it("refuses an unconfirmed booking and a foreign payment", async () => {
    const pending = await createHold({
      roomId,
      checkIn: "2033-06-01",
      checkOut: "2033-06-02",
    });
    await expect(issue(pending, null)).rejects.toThrow("booking_not_confirmed");

    const a = await paidBooking();
    const b = await paidBooking();
    await expect(issue(a.id, b.paymentId)).rejects.toThrow("payment_not_found");
  });
});

describe("credit notes (INV-05)", () => {
  it("links to the original and cannot exceed it", async () => {
    const { id, paymentId } = await paidBooking();
    const original = await issue(id, paymentId);

    // Six submissions of the same form: one wins, the rest are stale.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        credit(original.invoice_id, 4000, "Refund", 0),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // Separate, deliberate credits stop at the document total.
    await credit(original.invoice_id, 4000);
    await expect(credit(original.invoice_id, 4000)).rejects.toThrow(
      "credit_exceeds_invoice",
    );

    const { rows } = await db.query(
      `select credits_invoice_id, doc_type, is_provisional from public.invoices
       where credits_invoice_id = $1`,
      [original.invoice_id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      doc_type: "credit_note",
      is_provisional: true,
    });
  });

  it("requires a reason and cannot credit a credit note", async () => {
    const { id, paymentId } = await paidBooking();
    const original = await issue(id, paymentId);
    await expect(credit(original.invoice_id, 100, " ")).rejects.toThrow(
      "credit_reason_required",
    );
    const { rows } = await credit(original.invoice_id, 100);
    await expect(credit(rows[0].r.invoice_id, 50)).rejects.toThrow(
      "invoice_not_creditable",
    );
  });
});

describe("review fixes", () => {
  it("stores the document number and refuses a stale credit note", async () => {
    const { id, paymentId } = await paidBooking();
    const original = await issue(id, paymentId);
    const row = await invoice(original.invoice_id);
    expect(row.document_number).toBe(original.document_number);

    await credit(original.invoice_id, 100, "First", 0);
    await expect(
      credit(original.invoice_id, 100, "Back button", 0),
    ).rejects.toThrow("credit_already_changed");
    expect(await credited(original.invoice_id)).toBe(100);
  });

  it("a used series keeps its prefix, even from the owner", async () => {
    const prefix = `L-${randomUUID().slice(0, 8)}`;
    const { rows } = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active, last_number)
       values ('receipt', $1, false, 3) returning id`,
      [prefix],
    );
    await expect(
      db.query(
        `update public.invoice_series set prefix = 'NEW' where id = $1`,
        [rows[0].id],
      ),
    ).rejects.toThrow("invoice_series_in_use");
  });

  it("an unused series can be renamed at go-live", async () => {
    const { rows } = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active)
       values ('receipt', $1, false) returning id`,
      [`U-${randomUUID().slice(0, 8)}`],
    );
    await db.query(
      `update public.invoice_series set prefix = $2 where id = $1`,
      [rows[0].id, `V-${randomUUID().slice(0, 8)}`],
    );
  });

  it("no signed-in session can clear the provisional flag", async () => {
    const owner = await createAdmin("owner");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(
          `update public.settings
           set value = value || '{"isProvisional": false}' where key = 'invoicing'`,
        ),
      ),
    ).rejects.toThrow("provisional_flag_locked");

    const unchanged = await admin(owner.id, "aal2", (c) =>
      c.query(
        `update public.settings
         set value = value || '{"defaultDocType": "invoice"}' where key = 'invoicing'`,
      ),
    );
    expect(unchanged.rowCount).toBe(1);
  });
});

describe("immutability (INV-07)", () => {
  it("allows delivery fields only", async () => {
    const { id, paymentId } = await paidBooking();
    const { invoice_id } = await issue(id, paymentId);

    await db.query(`select public.attach_invoice_pdf($1, 'a/b.pdf')`, [
      invoice_id,
    ]);
    await db.query(`select public.mark_invoices_exported($1::uuid[])`, [
      [invoice_id],
    ]);
    const row = await invoice(invoice_id);
    expect(row.pdf_path).toBe("a/b.pdf");
    expect(row.exported_at).not.toBeNull();

    await expect(
      db.query(`update public.invoices set total_cents = 1 where id = $1`, [
        invoice_id,
      ]),
    ).rejects.toThrow("issued_invoice_immutable");
    await expect(
      db.query(
        `update public.invoices set is_provisional = false where id = $1`,
        [invoice_id],
      ),
    ).rejects.toThrow("issued_invoice_immutable");
  });

  it("exporting twice keeps the first date", async () => {
    const { id, paymentId } = await paidBooking();
    const { invoice_id } = await issue(id, paymentId);
    await db.query(`select public.mark_invoices_exported($1::uuid[])`, [
      [invoice_id],
    ]);
    const first = (await invoice(invoice_id)).exported_at;
    const again = await db.query(
      `select public.mark_invoices_exported($1::uuid[]) as n`,
      [[invoice_id]],
    );
    expect(again.rows[0].n).toBe(0);
    expect((await invoice(invoice_id)).exported_at).toEqual(first);
  });
});

describe("access", () => {
  it("only the owner reads invoices, and nobody writes them through the API", async () => {
    const { id, paymentId } = await paidBooking();
    await issue(id, paymentId);
    const owner = await createAdmin("owner");
    const staff = await createAdmin("staff");

    await expect(
      anon((c) => c.query(`select * from public.invoices`)),
    ).rejects.toThrow(/permission denied/);

    const seen = await admin(staff.id, "aal1", (c) =>
      c.query(`select id from public.invoices`),
    );
    expect(seen.rows).toEqual([]);

    const own = await admin(owner.id, "aal2", (c) =>
      c.query(`select id from public.invoices`),
    );
    expect(own.rows.length).toBeGreaterThan(0);

    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`update public.invoices set total_cents = 0`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select public.issue_invoice($1, 'receipt', '{}', '[]')`, [
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("the audit log keeps no customer details", async () => {
    const { id, paymentId } = await paidBooking();
    const { invoice_id } = await issue(id, paymentId);
    const { rows } = await db.query(
      `select after from public.audit_log where entity = 'invoices' and entity_id = $1`,
      [invoice_id],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("Test Guest");
  });
});
