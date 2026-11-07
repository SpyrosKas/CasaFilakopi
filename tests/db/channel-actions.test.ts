import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "../../lib/db/types";
import { localEnv } from "./channel-env";
import { createRoom, db } from "./helpers";

// The real server actions as a real Owner session: signed in, past TOTP, with
// migration 012 in force. Only the outside world is replaced: who the session
// belongs to comes from this test, and the feed comes from a stub.

const owner = vi.hoisted(() => ({ context: null as unknown }));
const pull = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "en" }) }),
}));
vi.mock("@/lib/admin/session", () => ({
  requireOwner: async () => owner.context,
}));
vi.mock("../../lib/channels/providers", () => ({
  defaultProvider: () => ({ pull }),
}));

const env = localEnv();

const { freeFeedDates, removeFeed, saveFeed } =
  await import("../../lib/channels/actions");
const { idleState } = await import("../../lib/admin/form-state");

const service = createClient<Database>(env.url, env.key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function totp(secret: string): string {
  let bits = "";
  for (const char of secret.replace(/=+$/, "")) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

let userId: string;
let session: SupabaseClient<Database>;
let roomId: string;

async function signInOwner() {
  const email = `channel-actions-${randomUUID()}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  userId = data.user.id;
  await db.query(
    `insert into public.admin_profiles (id, role, display_name) values ($1, 'owner', 'Test')`,
    [userId],
  );

  session = createClient<Database>(env.url, env.publishable, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await session.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const factor = await session.auth.mfa.enroll({ factorType: "totp" });
  if (factor.error) throw factor.error;
  const verified = await session.auth.mfa.challengeAndVerify({
    factorId: factor.data.id,
    code: totp(factor.data.totp.secret),
  });
  if (verified.error) throw verified.error;
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const link = () => `https://www.airbnb.com/calendar/${randomUUID()}.ics`;

const calendarRow = async () =>
  (
    await db.query(
      `select id, import_url, is_enabled from public.external_calendars
       where room_id = $1 and channel = 'airbnb'`,
      [roomId],
    )
  ).rows[0];

beforeAll(async () => {
  await signInOwner();
  owner.context = { supabase: session, userId };
  roomId = await createRoom();
  pull.mockResolvedValue({ ok: true, events: [], unreadable: 0 });
});

afterAll(async () => {
  await db.query(`delete from public.inventory_claims where room_id = $1`, [
    roomId,
  ]);
  await db.query(`delete from public.external_calendars where room_id = $1`, [
    roomId,
  ]);
  await db.query(`delete from public.rooms where id = $1`, [roomId]);
  await db.query(`delete from public.audit_log where actor_id = $1`, [userId]);
  await service.auth.admin.deleteUser(userId);
  await db.end();
});

describe("saving an import link as the signed-in Owner", () => {
  it("the session really is an Owner past TOTP", async () => {
    const { data } = await session.rpc("current_admin_role");
    expect(data).toBe("owner");
  });

  it("cannot read or write the link column itself (migration 012)", async () => {
    const read = await session
      .from("external_calendars")
      .select("import_url")
      .limit(1);
    expect(read.error?.message).toContain("permission denied");

    const write = await session
      .from("external_calendars")
      .upsert(
        { room_id: roomId, channel: "airbnb", import_url: link() },
        { onConflict: "room_id,channel" },
      );
    expect(write.error?.message).toContain("permission denied");
  });

  it("saves a new link through saveFeed", async () => {
    const url = link();
    const state = await saveFeed(
      idleState,
      form({ roomId, channel: "airbnb", url }),
    );
    expect(state).toMatchObject({ status: "ok" });
    expect(await calendarRow()).toMatchObject({
      import_url: url,
      is_enabled: true,
    });
  });

  it("replaces an existing link through saveFeed", async () => {
    const url = link();
    await saveFeed(idleState, form({ roomId, channel: "airbnb", url }));
    expect((await calendarRow()).import_url).toBe(url);
  });

  it("refuses the site's own host", async () => {
    pull.mockClear();
    const state = await saveFeed(
      idleState,
      form({
        roomId,
        channel: "airbnb",
        url: `${process.env.NEXT_PUBLIC_SITE_URL}/api/ical/airbnb-x.ics`,
      }),
    );
    expect(state.fieldErrors?.url).toContain("own link");
    expect(pull).not.toHaveBeenCalled();
  });
});

describe("removing a feed and freeing its dates", () => {
  const start = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  it("refuses to free dates while a link is saved", async () => {
    const state = await freeFeedDates(
      idleState,
      form({ roomId, channel: "airbnb" }),
    );
    expect(state.status).toBe("error");
  });

  it("keeps the dates on removal, then frees future stays only", async () => {
    const { id } = await calendarRow();
    await db.query(
      `select public.upsert_external_event($1, 'future', $2::date, $3::date)`,
      [id, start(30), start(35)],
    );
    await db.query(
      `select public.upsert_external_event($1, 'in-progress', $2::date, $3::date)`,
      [id, start(-2), start(2)],
    );

    const removed = await removeFeed(
      idleState,
      form({ roomId, channel: "airbnb" }),
    );
    expect(removed).toMatchObject({ status: "ok" });
    expect(await calendarRow()).toMatchObject({
      import_url: null,
      is_enabled: false,
    });
    const before = await db.query(
      `select count(*)::int as n from public.inventory_claims where room_id = $1`,
      [roomId],
    );
    expect(before.rows[0].n).toBe(2);

    const freed = await freeFeedDates(
      idleState,
      form({ roomId, channel: "airbnb" }),
    );
    expect(freed.message).toContain("1 stay was freed");

    const { rows } = await db.query(
      `select uid from public.external_events where calendar_id = $1`,
      [id],
    );
    expect(rows.map((row) => row.uid)).toEqual(["in-progress"]);
  });
});
