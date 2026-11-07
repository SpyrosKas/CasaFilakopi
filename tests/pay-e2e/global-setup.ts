import pg from "pg";

// Gives the browser tests a house of their own, and removes everything made
// with it afterwards. The local database is shared with other tracks.

const connectionString =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function removeRoom(roomId: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select id, guest_id from public.bookings where room_id = $1`,
      [roomId],
    );
    const ids = rows.map((row) => row.id);
    const guests = rows.map((row) => row.guest_id);
    await client.query(
      `delete from public.email_logs where booking_id = any($1)`,
      [ids],
    );
    await client.query(
      `delete from public.contact_messages where booking_id = any($1)`,
      [ids],
    );
    await client.query(
      `delete from public.consent_log where subject = any($1)`,
      [ids.map(String)],
    );
    await client.query(
      `delete from public.refunds where booking_id = any($1)`,
      [ids],
    );
    await client.query(
      `delete from public.payments where booking_id = any($1)`,
      [ids],
    );
    await client.query(`delete from public.bookings where id = any($1)`, [ids]);
    await client.query(`delete from public.guests where id = any($1)`, [
      guests,
    ]);
    await client.query(`delete from public.rooms where id = $1`, [roomId]);
    await client.query(
      `delete from public.admin_attempts where scope like 'pay\\_%'`,
    );
    await client.query(
      `delete from public.stripe_events where payload->>'object_type' = 'checkout.session' and received_at > now() - interval '2 hours'`,
    );
  } finally {
    await client.end();
  }
}

export default async function globalSetup() {
  const roomId = process.env.PAY_TEST_ROOM_ID!;
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(
    `insert into public.rooms (id, slug, name, max_adults, max_children, base_occupancy, base_price_cents)
     values ($1, $2, '{"en":"Pay test","el":"Pay test"}', 4, 2, 2, 15000)`,
    [roomId, `pay-e2e-${roomId}`],
  );
  await client.end();
  return () => removeRoom(roomId);
}
