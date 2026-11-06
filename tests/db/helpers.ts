import { randomUUID } from "node:crypto";
import pg from "pg";

// Types come back as strings so dates are compared exactly as stored.
pg.types.setTypeParser(1082, (v) => v);

export const db = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 60,
});

export const RULES = JSON.stringify({ payment: { mode: "full" } });
export const PRICE = JSON.stringify({ nights: [] });
export const FAR_TOKEN_EXPIRY = "2099-01-01T00:00:00Z";

export async function createRoom(): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.rooms (id, slug, name, max_adults, base_occupancy, base_price_cents)
     values ($1, $2, '{"en":"Test"}', 4, 2, 10000)`,
    [id, `test-${id}`],
  );
  return id;
}

export interface HoldInput {
  roomId: string;
  checkIn: string;
  checkOut: string;
  email?: string;
  name?: string;
  token?: string;
  minutes?: number;
  promo?: string;
  marketing?: boolean;
}

export async function createHold(input: HoldInput): Promise<string> {
  const { rows } = await db.query(
    `select public.create_hold(
       $1, $2::date, $3::date, 2, 0, $4::jsonb, $5::jsonb, 10000, 10000, $6::jsonb,
       'v1', $7, $8::timestamptz, $9, $10
     ) as result`,
    [
      input.roomId,
      input.checkIn,
      input.checkOut,
      JSON.stringify({
        email: input.email ?? `${randomUUID()}@example.test`,
        name: input.name ?? "Test Guest",
        locale: "en",
        marketing_consent: input.marketing ?? false,
      }),
      PRICE,
      RULES,
      input.token
        ? (
            await db.query(
              `select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`,
              [input.token],
            )
          ).rows[0].h
        : randomUUID(),
      FAR_TOKEN_EXPIRY,
      input.minutes ?? 35,
      input.promo ?? null,
    ],
  );
  return rows[0].result.booking_id;
}

export async function expireHold(bookingId: string) {
  await db.query(
    `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
    [bookingId],
  );
}

export async function confirm(bookingId: string, intent = randomUUID()) {
  const { rows } = await db.query(
    `select public.confirm_booking($1, 'full', 10000, $2, $3) as result`,
    [bookingId, intent, randomUUID()],
  );
  return rows[0].result as { outcome: string; reference?: string };
}

export async function createAdmin(
  role: "owner" | "staff",
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `${id}@example.test`],
  );
  await db.query(
    `insert into public.admin_profiles (id, role, display_name) values ($1, $2, 'Test')`,
    [id, role],
  );
  return { id };
}

type Claims = { sub: string; aal: string; role: string };

/** Runs a query as a real database role with JWT claims, then rolls back. */
export async function asRole<T>(
  role: "anon" | "authenticated" | "service_role",
  claims: Claims | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims ?? { role }),
    ]);
    await client.query(`set local role ${role}`);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

export const anon = <T>(fn: (c: pg.PoolClient) => Promise<T>) =>
  asRole("anon", null, fn);

export const admin = <T>(
  id: string,
  aal: "aal1" | "aal2",
  fn: (c: pg.PoolClient) => Promise<T>,
) => asRole("authenticated", { sub: id, aal, role: "authenticated" }, fn);
