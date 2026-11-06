import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db/admin";

const consentBody = z.object({
  granted: z.boolean(),
  policyVersion: z.string().min(1).max(40),
  subject: z.uuid(),
});

const MAX_BODY_BYTES = 1024;

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  return URL.canParse(origin) && new URL(origin).host === host;
}

/**
 * Logs a cookie choice (WEB-12, CMP-04). No IP or user agent is stored: the
 * subject is a random id created in the visitor's browser.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = consentBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const { error } = await createAdminClient().from("consent_log").insert({
      kind: "cookies",
      subject: parsed.data.subject,
      policy_version: parsed.data.policyVersion,
      granted: parsed.data.granted,
    });
    if (error) throw new Error(error.code);
  } catch (error) {
    console.error("consent_log insert failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return new NextResponse(null, { status: 204 });
}
