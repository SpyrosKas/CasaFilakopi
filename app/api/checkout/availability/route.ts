import {
  fail,
  limitedByAddress,
  reply,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { loadAvailability } from "@/lib/payments/quote";
import { LIMITS } from "@/lib/payments/rate-limit";
import { paymentDeps } from "@/lib/payments/server";

/** Which nights are free. Never why the others are not (AVL-09). */
export async function GET(request: Request) {
  const deps = paymentDeps();
  try {
    if (await limitedByAddress(deps, LIMITS.availability, request)) {
      return tooMany();
    }
    const view = await loadAvailability(deps);
    return view ? reply(view) : fail("closed", 404);
  } catch (error) {
    return unavailable("availability", error);
  }
}
