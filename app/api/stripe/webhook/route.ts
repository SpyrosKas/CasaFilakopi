import { NextResponse } from "next/server";
import { readCapped } from "@/lib/email/read-body";
import { sendQueued } from "@/lib/payments/http";
import { paymentDeps } from "@/lib/payments/server";
import { handleStripeWebhook } from "@/lib/payments/webhook";

export const maxDuration = 60;

/** Far above any real event, well below a body worth reading. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** The raw text is what Stripe signed, so nothing may parse it first. */
export async function POST(request: Request) {
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const deps = paymentDeps();
  const { status, body } = await handleStripeWebhook(
    deps,
    raw,
    request.headers.get("stripe-signature"),
  );
  sendQueued(deps);
  return NextResponse.json(body, { status });
}
