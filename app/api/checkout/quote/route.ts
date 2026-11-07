import { getServerEnv } from "@/lib/env.server";
import {
  limitedByAddress,
  readJson,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { quoteStay } from "@/lib/payments/quote";
import {
  countFailure,
  hasUsedUp,
  LIMITS,
  requestAddress,
} from "@/lib/payments/rate-limit";
import { quoteSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

/** The live price (BKG-05, BKG-06). The browser sends a stay, never an amount. */
export async function POST(request: Request) {
  const parsed = await readJson(request, quoteSchema, 2048);
  if ("response" in parsed) return parsed.response;

  const deps = paymentDeps();
  try {
    if (await limitedByAddress(deps, LIMITS.quote, request)) return tooMany();

    const { promoCode, ...stay } = parsed.data;
    if (!promoCode) return reply(await quoteStay(deps, stay));

    // Guessing codes gets the same answer as a wrong code, and nothing more.
    const secret = getServerEnv().SUPABASE_SECRET_KEY;
    const address = requestAddress(request);
    if (await hasUsedUp(deps.db, LIMITS.promo, address, secret)) {
      const quote = await quoteStay(deps, stay);
      return reply(quote.ok ? { ...quote, promoRejected: true } : quote);
    }
    const quote = await quoteStay(deps, parsed.data);
    if (quote.ok && quote.promoRejected) {
      await countFailure(deps.db, LIMITS.promo, address, secret);
    }
    return reply(quote);
  } catch (error) {
    return unavailable("quote", error);
  }
}
