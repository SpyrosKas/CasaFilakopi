import {
  limitedByAddress,
  readJson,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { quoteStay } from "@/lib/payments/quote";
import { LIMITS } from "@/lib/payments/rate-limit";
import { quoteSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

/** The live price (BKG-05, BKG-06). The browser sends a stay, never an amount. */
export async function POST(request: Request) {
  const parsed = await readJson(request, quoteSchema, 2048);
  if ("response" in parsed) return parsed.response;

  const deps = paymentDeps();
  try {
    if (await limitedByAddress(deps, LIMITS.quote, request)) return tooMany();
    return reply(await quoteStay(deps, parsed.data));
  } catch (error) {
    return unavailable("quote", error);
  }
}
