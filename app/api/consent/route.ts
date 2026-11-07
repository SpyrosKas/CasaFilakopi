import { NextResponse } from "next/server";
import { z } from "zod";
import { COOKIE_POLICY_VERSION } from "@/content/consent";
import { createAdminClient } from "@/lib/db/admin";
import { clientAddress, isClientLimited } from "./rate-limit";

const consentBody = z.strictObject({
  granted: z.boolean(),
  policyVersion: z.literal(COOKIE_POLICY_VERSION),
  subject: z.uuid(),
});

const MAX_BODY_BYTES = 1024;

// Throttle, with no new service and no schema change (PLT-05):
// 1. Per client, in memory (rate-limit.ts). Stops one browser or script fast,
//    before any database work. Each serverless instance counts on its own, so
//    it is a soft limit, and x-forwarded-for can be forged away from Vercel.
// 2. Across all instances, from consent_log itself: if the row this many places
//    back is under a minute old, the table is filling too fast. It reads the
//    primary key, so its cost stays flat however large the table grows. This
//    is the real ceiling on writes, and no address is involved.
// When either trips, the visitor's choice still applies in their browser; only
// its log row is skipped.
const MAX_ROWS_PER_MINUTE = 120;
const MINUTE_MS = 60_000;

/** Exact origins, scheme included. Forwarded headers are not trusted here. */
function allowedOrigins(request: Request) {
  const origins: string[] = [];
  const add = (url: string | undefined) => {
    if (url && URL.canParse(url)) origins.push(new URL(url).origin);
  };

  add(process.env.NEXT_PUBLIC_SITE_URL);
  // Set by Vercel itself, for preview deployments.
  if (process.env.VERCEL_URL) add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) {
    add(`https://${process.env.VERCEL_BRANCH_URL}`);
  }
  if (process.env.NODE_ENV !== "production") {
    add(`http://${request.headers.get("host")}`);
  }
  return origins;
}

/** Reads at most MAX_BODY_BYTES; null means the body was larger. */
async function readBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

const tooMany = () => fail("rate_limited", 429, { "retry-after": "60" });

async function tableIsFilling(db: ReturnType<typeof createAdminClient>) {
  const { data, error } = await db
    .from("consent_log")
    .select("created_at")
    .order("id", { ascending: false })
    .range(MAX_ROWS_PER_MINUTE - 1, MAX_ROWS_PER_MINUTE - 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && Date.now() - Date.parse(data.created_at) < MINUTE_MS;
}

/**
 * Logs a cookie choice (WEB-12, CMP-04). No IP or user agent is stored: the
 * subject is a random id created in the visitor's browser.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(request).includes(origin)) {
    return fail("forbidden", 403);
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail("too_large", 413);

  if (isClientLimited(clientAddress(request))) return tooMany();

  const raw = await readBody(request);
  if (raw === null) return fail("too_large", 413);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("invalid", 400);
  }
  const parsed = consentBody.safeParse(json);
  if (!parsed.success) return fail("invalid", 400);

  try {
    const db = createAdminClient();
    if (await tableIsFilling(db)) return tooMany();

    const { error } = await db.from("consent_log").insert({
      kind: "cookies",
      subject: parsed.data.subject,
      policy_version: parsed.data.policyVersion,
      granted: parsed.data.granted,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`consent_log insert failed: ${message}`);
    return fail("unavailable", 503);
  }

  return new NextResponse(null, { status: 204 });
}
