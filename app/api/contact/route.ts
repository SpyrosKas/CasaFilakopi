import { after, NextResponse } from "next/server";
import { attemptHash } from "@/lib/admin/activity";
import { athensDate } from "@/lib/domain/dates";
import { pickClientAddress } from "@/lib/admin/client-address";
import { createAdminClient } from "@/lib/db/admin";
import { kickEmails, queueEmail } from "@/lib/email";
import {
  CONTACT_POLICY_VERSION,
  contactSchema,
  turnstileMode,
  verifyTurnstile,
} from "@/lib/email/contact";
import { readCapped } from "@/lib/email/read-body";
import { getServerEnv } from "@/lib/env.server";

const MAX_BODY_BYTES = 16 * 1024;

// Rate limit (CNT-04). Tries are rows in admin_attempts, shared by all servers.
// The address exists only as a keyed hash: no raw IP is ever stored. The second
// limit is for a flood from many addresses, which would otherwise fill the
// host's inbox and use up the sending allowance.
const ATTEMPT_SCOPE = "contact_form";
const MAX_PER_ADDRESS = 5;
const MAX_PER_SITE = 60;
const WINDOW_MS = 60 * 60_000;

/** Exact origins, scheme included. Same rule as /api/consent. */
function allowedOrigins(request: Request) {
  const origins: string[] = [];
  const add = (url: string | undefined) => {
    if (url && URL.canParse(url)) origins.push(new URL(url).origin);
  };
  add(process.env.NEXT_PUBLIC_SITE_URL);
  if (process.env.VERCEL_URL) add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) {
    add(`https://${process.env.VERCEL_BRANCH_URL}`);
  }
  if (process.env.NODE_ENV !== "production") {
    add(`http://${request.headers.get("host")}`);
  }
  return origins;
}

const fail = (error: string, status: number, headers?: HeadersInit) =>
  NextResponse.json({ error }, { status, headers });

const tooMany = () => fail("rate_limited", 429, { "retry-after": "3600" });

async function isLimited(
  db: ReturnType<typeof createAdminClient>,
  request: Request,
): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const address = pickClientAddress(
    (name) => request.headers.get(name),
    Boolean(process.env.VERCEL),
  );
  const key_hash = attemptHash(getServerEnv().SUPABASE_SECRET_KEY, address);

  const site = await db
    .from("contact_messages")
    .select("id", { count: "exact", head: true })
    .gt("created_at", since);
  if (site.error) throw new Error(site.error.message);
  if ((site.count ?? 0) >= MAX_PER_SITE) return true;

  const scoped = () =>
    db
      .from("admin_attempts")
      .select("id", { count: "exact", head: true })
      .eq("scope", ATTEMPT_SCOPE)
      .eq("key_hash", key_hash)
      .gt("created_at", since);

  const before = await scoped();
  if (before.error) throw new Error(before.error.message);
  if ((before.count ?? 0) >= MAX_PER_ADDRESS) return true;

  // Row first, count second, so a burst at once cannot all get through.
  const { error } = await db
    .from("admin_attempts")
    .insert({ scope: ATTEMPT_SCOPE, key_hash });
  if (error) throw new Error(error.message);

  const counted = await scoped();
  if (counted.error) throw new Error(counted.error.message);
  return (counted.count ?? 0) > MAX_PER_ADDRESS;
}

/** The guest can always reach Yorgos: the message is safe before email runs. */
async function notify(contactMessageId: string): Promise<string[]> {
  const results = await Promise.all([
    queueEmail("host_contact_message", { contactMessageId }),
    // One a day per address, so the form cannot be used to mail-bomb someone.
    queueEmail(
      "contact_auto_reply",
      { contactMessageId },
      { dedupeKey: `contact_auto_reply:${athensDate(new Date())}` },
    ),
  ]);
  return results.flatMap((result) => (result.ok ? result.ids : []));
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(request).includes(origin)) {
    return fail("forbidden", 403);
  }

  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) return fail("too_large", 413);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("invalid", 400);
  }
  const parsed = contactSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ];
    return NextResponse.json({ error: "invalid", fields }, { status: 400 });
  }
  const input = parsed.data;

  // Looks like success, so a bot learns nothing.
  if (input.website) return NextResponse.json({ ok: true });

  const check = turnstileMode(process.env);
  if (check === "closed") return fail("closed", 503);

  const db = createAdminClient();
  let id: string;
  try {
    if (await isLimited(db, request)) return tooMany();

    if (check === "enforced") {
      const passed = await verifyTurnstile(
        input.turnstileToken,
        process.env.TURNSTILE_SECRET_KEY!,
      );
      if (!passed) return fail("verification_failed", 403);
    }

    const { data, error } = await db
      .from("contact_messages")
      .insert({
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        dates_of_interest: input.dates || null,
        message: input.message,
        locale: input.locale,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    id = data.id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`contact form failed: ${message}`);
    return fail("unavailable", 503);
  }

  // Everything after the save is best effort. The message is in the inbox.
  try {
    const { error } = await db.from("consent_log").insert({
      kind: "contact_form",
      subject: id,
      policy_version: CONTACT_POLICY_VERSION,
      granted: true,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    // The tick is proven by the form refusing without it, so email still goes.
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`contact message ${id}: consent not logged: ${message}`);
  }

  try {
    const ids = await notify(id);
    after(() => kickEmails(ids));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`contact message ${id} saved, email failed: ${message}`);
  }
  return NextResponse.json({ ok: true });
}
