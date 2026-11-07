import { cancelForGuest } from "@/lib/payments/guest";
import {
  fail,
  overLimit,
  readJson,
  reply,
  sendQueued,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { LIMITS, requestAddress } from "@/lib/payments/rate-limit";
import { guestCancelSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = await readJson(request, guestCancelSchema, 1024);
  if ("response" in parsed) return parsed.response;

  const deps = paymentDeps();
  try {
    if (await overLimit(deps, LIMITS.guestCancel, requestAddress(request))) {
      return tooMany();
    }
    const result = await cancelForGuest(
      deps,
      parsed.data.token,
      parsed.data.expectedRefundCents,
    );
    sendQueued(deps);
    if (result.kind === "not_found") return fail("not_found", 404);
    return result.kind === "cancelled" ? reply(result) : fail(result.kind, 409);
  } catch (error) {
    return unavailable("guest cancel", error);
  }
}
