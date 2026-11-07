import "server-only";
import { after, NextResponse } from "next/server";
import { kickEmails } from "@/lib/email";
import { readCapped } from "@/lib/email/read-body";
import { getServerEnv } from "@/lib/env.server";
import type { z } from "zod";
import type { PaymentDeps } from "./deps";
import { PaymentsClosedError } from "./deps";
import { isAllowedOrigin } from "./origin";
import { isOverLimit, requestAddress, type Limit } from "./rate-limit";

// Shared by the routes under app/api/checkout. Answers are never cached: they
// describe live dates, prices or one guest's booking.

const NO_STORE = { "cache-control": "private, no-store" };

export const reply = (body: unknown, status = 200, headers?: HeadersInit) =>
  NextResponse.json(body, {
    status,
    headers: { ...NO_STORE, ...Object.fromEntries(new Headers(headers)) },
  });

export const fail = (error: string, status: number, extra?: object) =>
  reply({ error, ...extra }, status);

/** Parses a JSON body from this site, or gives the response to return. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes = 16 * 1024,
): Promise<{ data: z.output<S> } | { response: NextResponse }> {
  if (!isAllowedOrigin(request)) return { response: fail("forbidden", 403) };
  const raw = await readCapped(request, maxBytes);
  if (raw === null) return { response: fail("too_large", 413) };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { response: fail("invalid", 400) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ];
    return { response: fail("invalid", 400, { fields }) };
  }
  return { data: parsed.data };
}

export async function overLimit(
  deps: PaymentDeps,
  limit: Limit,
  key: string,
): Promise<boolean> {
  return isOverLimit(deps.db, limit, key, getServerEnv().SUPABASE_SECRET_KEY);
}

export const limitedByAddress = (
  deps: PaymentDeps,
  limit: Limit,
  request: Request,
) => overLimit(deps, limit, requestAddress(request));

export function tooMany() {
  return reply({ error: "rate_limited" }, 429, { "retry-after": "60" });
}

/** Sends what this request queued, after the answer has gone. */
export function sendQueued(deps: PaymentDeps) {
  const ids = [...deps.queued];
  if (ids.length > 0) after(() => kickEmails(ids));
}

/** The guest sees a plain message. The reason stays in the log. */
export function unavailable(where: string, error: unknown) {
  if (error instanceof PaymentsClosedError) {
    return fail("payments_closed", 503);
  }
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`${where} failed: ${message}`);
  return fail("unavailable", 503);
}
