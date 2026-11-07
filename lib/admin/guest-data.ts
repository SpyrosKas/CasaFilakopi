import "server-only";
import { assertAdminRole } from "@/lib/admin/audit";
import {
  isSamePerson,
  type GuestDataExport,
  type Identity,
} from "@/lib/admin/guest-export";
import type { AdminContext } from "@/lib/admin/session";
import { readAll } from "@/lib/admin/stay-data";
import { createAdminClient } from "@/lib/db/admin";

// Everything held about one person, for a data request (CMP-02). It uses the
// secret key because money and imported amounts are outside what a signed-in
// session can read, so the role is checked first, in the database.

type Client = ReturnType<typeof createAdminClient>;

/** A guest key is a guest's id, or an imported stay's id for someone with none. */
export type Subject =
  | { kind: "guest"; id: string; anonymisedAt: string | null }
  | { kind: "external"; id: string };

export async function findSubject(
  db: Client,
  key: string,
): Promise<Subject | null> {
  const { data: guest, error } = await db
    .from("guests")
    .select("id, anonymized_at")
    .eq("id", key)
    .maybeSingle();
  if (error) throw error;
  if (guest) {
    return {
      kind: "guest",
      id: guest.id,
      anonymisedAt: guest.anonymized_at,
    };
  }
  const { data: event, error: eventError } = await db
    .from("external_events")
    .select("id")
    .eq("id", key)
    .maybeSingle();
  if (eventError) throw eventError;
  return event ? { kind: "external", id: event.id } : null;
}

const BOOKING_COLUMNS =
  "id, guest_id, reference, status, source, check_in, check_out, adults, children, guest_name, guest_email, guest_phone, guest_country, locale, arrival_time, special_requests, internal_notes, cancellation_reason, total_cents, marketing_consent, terms_version, terms_accepted_at, created_at";

const EVENT_COLUMNS =
  "id, start_date, end_date, summary, guest_name, guest_email, guest_phone, guest_notes, amount_cents, external_calendars ( channel )";

const present = (values: (string | null)[]) => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
];

async function allOf<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
  }>,
): Promise<T[]> {
  return readAll(query);
}

export async function loadGuestData(
  admin: AdminContext,
  key: string,
): Promise<GuestDataExport | null> {
  await assertAdminRole(admin);
  const db = createAdminClient();
  const subject = await findSubject(db, key);
  if (!subject) return null;

  const guest =
    subject.kind === "guest"
      ? (
          await db
            .from("guests")
            .select(
              "id, email, full_name, phone, country, locale, marketing_consent, created_at",
            )
            .eq("id", subject.id)
            .single()
        ).data
      : null;

  // As the database does when erasing: their own, plus any under their address.
  const bookings = guest
    ? (
        await allOf((from, to) =>
          db
            .from("bookings")
            .select(BOOKING_COLUMNS)
            .order("check_in")
            .range(from, to),
        )
      ).filter(
        (booking) =>
          booking.guest_id === guest.id ||
          (guest.email &&
            booking.guest_email?.trim().toLowerCase() ===
              guest.email.trim().toLowerCase()),
      )
    : [];

  const events = await allOf((from, to) =>
    db
      .from("external_events")
      .select(EVENT_COLUMNS)
      .order("start_date")
      .range(from, to),
  );

  const start = events.find((event) => event.id === key);
  const identity: Identity = {
    emails: present([
      guest?.email ?? null,
      start?.guest_email ?? null,
      ...bookings.map((booking) => booking.guest_email),
    ]),
    phones: present([
      guest?.phone ?? null,
      start?.guest_phone ?? null,
      ...bookings.map((booking) => booking.guest_phone),
    ]),
    names: present([
      guest?.full_name ?? null,
      start?.guest_name ?? null,
      ...bookings.map((booking) => booking.guest_name),
    ]),
  };

  const bookingIds = bookings.map((booking) => booking.id);
  const [payments, refunds, invoices, allMessages] = await Promise.all([
    db
      .from("payments")
      .select("booking_id, kind, method, status, amount_cents, note, paid_at")
      .in("booking_id", bookingIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    db
      .from("refunds")
      .select("booking_id, amount_cents, status, reason, created_at")
      .in("booking_id", bookingIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    db
      .from("invoices")
      .select(
        "booking_id, document_number, doc_type, status, issued_at, total_cents, customer",
      )
      .in("booking_id", bookingIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data;
      }),
    allOf((from, to) =>
      db
        .from("contact_messages")
        .select(
          "id, name, email, phone, dates_of_interest, message, booking_id, created_at",
        )
        .order("created_at")
        .range(from, to),
    ),
  ]);

  const messages = allMessages.filter(
    (row) =>
      (row.booking_id && bookingIds.includes(row.booking_id)) ||
      isSamePerson(
        { email: row.email, phone: row.phone, name: row.name },
        identity,
      ),
  );

  const emails = await loadEmails(
    db,
    bookingIds,
    messages.map((row) => row.id),
    identity.emails,
  );

  const consentSubjects = [...bookingIds, ...messages.map((row) => row.id)];
  const { data: consents, error: consentError } = await db
    .from("consent_log")
    .select("kind, policy_version, granted, created_at")
    .in("subject", consentSubjects);
  if (consentError) throw consentError;

  return {
    guest,
    identity,
    bookings,
    payments,
    refunds,
    invoices,
    messages,
    emails,
    consents,
    imported: events
      .filter(
        (event) =>
          event.id === key ||
          isSamePerson(
            {
              email: event.guest_email,
              phone: event.guest_phone,
              name: event.guest_name,
            },
            identity,
          ),
      )
      .map((event) => ({
        ...event,
        channel: event.external_calendars?.channel ?? null,
      })),
  };
}

const LOG_COLUMNS = "template_key, recipient, status, created_at, sent_at";

/** Wildcards in an address must match themselves. */
const exactly = (value: string) => value.replace(/[\\%_]/g, "\\$&");

async function loadEmails(
  db: Client,
  bookingIds: string[],
  messageIds: string[],
  addresses: string[],
) {
  const reads = [
    db.from("email_logs").select(LOG_COLUMNS).in("booking_id", bookingIds),
    db
      .from("email_logs")
      .select(LOG_COLUMNS)
      .in("contact_message_id", messageIds),
    ...addresses.map((address) =>
      db
        .from("email_logs")
        .select(LOG_COLUMNS)
        .ilike("recipient", exactly(address)),
    ),
  ];
  const results = await Promise.all(reads);
  const rows = results.flatMap(({ data, error }) => {
    if (error) throw error;
    return data;
  });
  const unique = new Map(
    rows.map((row) => [
      `${row.template_key}|${row.recipient}|${row.created_at}`,
      row,
    ]),
  );
  return [...unique.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}
