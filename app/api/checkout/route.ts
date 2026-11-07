import { turnstileMode, verifyTurnstile } from "@/lib/email/contact";
import {
  CHECKOUT_COOKIE,
  CHECKOUT_COOKIE_PATH,
  CHECKOUT_COOKIE_SECONDS,
  startCheckout,
} from "@/lib/payments/checkout";
import {
  fail,
  limitedByAddress,
  overLimit,
  readJson,
  reply,
  sendQueued,
  tooMany,
  unavailable,
} from "@/lib/payments/http";
import { LIMITS } from "@/lib/payments/rate-limit";
import { checkoutSchema } from "@/lib/payments/schemas";
import { paymentDeps } from "@/lib/payments/server";

export const maxDuration = 60;

/** Reads the guest's latest attempt: see startCheckout. */
function attemptCookie(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CHECKOUT_COOKIE) return rest.join("=");
  }
  return undefined;
}

export async function POST(request: Request) {
  const parsed = await readJson(request, checkoutSchema);
  if ("response" in parsed) return parsed.response;

  const { turnstileToken, ...input } = parsed.data;

  const deps = paymentDeps();
  const check = turnstileMode(process.env);
  if (!deps.stripe || !deps.guestTokenSecret || check === "closed") {
    return fail("payments_closed", 503);
  }

  try {
    if (await limitedByAddress(deps, LIMITS.checkout, request)) {
      return tooMany();
    }
    if (check === "enforced") {
      const passed = await verifyTurnstile(
        turnstileToken,
        process.env.TURNSTILE_SECRET_KEY!,
      );
      if (!passed) return fail("verification_failed", 403);
    }
    if (await overLimit(deps, LIMITS.checkoutSite, "site")) return tooMany();

    const result = await startCheckout(deps, input, attemptCookie(request));
    sendQueued(deps);

    if (result.kind === "rejected") {
      return fail(result.reason, 409);
    }

    const response = reply(
      result.kind === "redirect" ? { url: result.url } : { path: result.path },
    );
    response.cookies.set(CHECKOUT_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: CHECKOUT_COOKIE_PATH,
      maxAge: CHECKOUT_COOKIE_SECONDS,
    });
    return response;
  } catch (error) {
    return unavailable("checkout", error);
  }
}
