import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/admin";
import { logError, logWarn } from "@/lib/log";
import { readCapped } from "@/lib/email/read-body";
import { applyEvent, verifyEvent } from "@/lib/email/webhook";

const MAX_BODY_BYTES = 256 * 1024;

/** Resend delivery events (EML-08). The signature covers the exact raw bytes. */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logWarn("email_webhook.not_configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await readCapped(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const event = verifyEvent(
    rawBody,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
  );
  if (!event) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  try {
    const outcome = await applyEvent(createAdminClient(), event as never);
    return NextResponse.json({ outcome });
  } catch (error) {
    // A 500 makes Resend send it again later.
    await logError("email_webhook.failed", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
