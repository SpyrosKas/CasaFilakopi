import { releaseFromCancelPage } from "@/lib/payments/checkout";
import {
  fail,
  limitedByAddress,
  readJson,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { LIMITS } from "@/lib/payments/rate-limit";
import { releaseSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

/**
 * The guest pressed back on Stripe's page. The cancel page calls this once it
 * has loaded, as a POST so a link scanner following the URL frees nothing.
 */
export async function POST(request: Request) {
  const parsed = await readJson(request, releaseSchema, 1024);
  if ("response" in parsed) return parsed.response;

  const deps = paymentDeps();
  if (!deps.stripe || !deps.guestTokenSecret) {
    return fail("payments_closed", 503);
  }
  try {
    if (await limitedByAddress(deps, LIMITS.release, request)) {
      return tooMany();
    }
    const released = await releaseFromCancelPage(deps, parsed.data.key);
    return released ? reply({ ok: true }) : fail("not_found", 404);
  } catch (error) {
    return unavailable("release", error);
  }
}
