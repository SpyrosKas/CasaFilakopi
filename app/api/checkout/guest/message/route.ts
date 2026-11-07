import { messageHost } from "@/lib/payments/guest";
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
import { guestMessageSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

export async function POST(request: Request) {
  const parsed = await readJson(request, guestMessageSchema);
  if ("response" in parsed) return parsed.response;
  const { token, message, cancelRequest } = parsed.data;

  const deps = paymentDeps();
  try {
    if (await overLimit(deps, LIMITS.guestMessage, requestAddress(request))) {
      return tooMany();
    }
    const sent = await messageHost(deps, token, message, cancelRequest);
    sendQueued(deps);
    return sent ? reply({ ok: true }) : fail("not_found", 404);
  } catch (error) {
    return unavailable("guest message", error);
  }
}
