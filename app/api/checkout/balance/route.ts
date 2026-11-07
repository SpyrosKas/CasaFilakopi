import { startBalancePayment } from "@/lib/payments/balance";
import { bookingForToken } from "@/lib/payments/guest";
import {
  fail,
  overLimit,
  readJson,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { LIMITS, requestAddress } from "@/lib/payments/rate-limit";
import { balanceSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

export const maxDuration = 60;

/** Pay what is left. The amount is worked out here, never sent by the page. */
export async function POST(request: Request) {
  const parsed = await readJson(request, balanceSchema, 1024);
  if ("response" in parsed) return parsed.response;

  const deps = paymentDeps();
  if (!deps.stripe) return fail("payments_closed", 503);
  try {
    if (await overLimit(deps, LIMITS.balance, requestAddress(request))) {
      return tooMany();
    }
    const booking = await bookingForToken(deps, parsed.data.token);
    if (!booking) return fail("not_found", 404);

    const result = await startBalancePayment(
      deps,
      booking.id,
      parsed.data.locale,
    );
    return result.kind === "redirect"
      ? reply({ url: result.url })
      : fail(result.kind, 409);
  } catch (error) {
    return unavailable("balance", error);
  }
}
