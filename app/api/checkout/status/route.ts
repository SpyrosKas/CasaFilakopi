import { checkoutState } from "@/lib/payments/checkout";
import {
  fail,
  limitedByAddress,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { LIMITS } from "@/lib/payments/rate-limit";
import { sessionIdSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

/** Polled by the return page until the webhook lands. */
export async function GET(request: Request) {
  const sessionId = sessionIdSchema.safeParse(
    new URL(request.url).searchParams.get("session_id"),
  );
  if (!sessionId.success) return fail("not_found", 404);

  const deps = paymentDeps();
  if (!deps.stripe) return fail("payments_closed", 503);
  try {
    if (await limitedByAddress(deps, LIMITS.status, request)) return tooMany();
    const state = await checkoutState(deps, sessionId.data);
    return state.state === "unknown" ? fail("not_found", 404) : reply(state);
  } catch (error) {
    return unavailable("status", error);
  }
}
