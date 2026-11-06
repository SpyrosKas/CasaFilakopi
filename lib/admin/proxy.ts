import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import {
  checkActivity,
  createActivityValue,
  readActivityValue,
} from "@/lib/admin/activity";
import { readClaims } from "@/lib/admin/claims";
import {
  ACTIVITY_COOKIE,
  ADMIN_COOKIE_OPTIONS,
  PUBLIC_ADMIN_PATHS,
} from "@/lib/admin/config";
import type { Database } from "@/lib/db/types";
import { getPublicEnv } from "@/lib/env";

// Keeps the session fresh and enforces the timeout before any admin page runs.
// This is not the access check: pages and server actions each call
// requireAdmin() or requireOwner() in lib/admin/session.ts.

function applyHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function adminProxy(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not set");

  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: ADMIN_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_ADMIN_PATHS.includes(path);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectToLogin = (expired: boolean) => {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = expired ? "?expired=1" : "";
    const target = NextResponse.redirect(url);
    // Carries over cookies Supabase cleared or refreshed on this request.
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return applyHeaders(target);
  };

  if (!user) {
    return isPublic ? applyHeaders(response) : redirectToLogin(false);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = readClaims(session?.access_token ?? "");
  const now = Math.floor(Date.now() / 1000);
  const activity = checkActivity({
    lastActive: claims.sessionId
      ? readActivityValue(
          request.cookies.get(ACTIVITY_COOKIE)?.value,
          claims.sessionId,
          secret,
        )
      : null,
    signedInAt: claims.signedInAt,
    now,
  });

  if (activity === "expired") {
    // A link from a reset email can arrive with an older session in place.
    if (path === "/admin/auth/confirm") return applyHeaders(response);
    await supabase.auth.signOut({ scope: "local" });
    request.cookies.delete(ACTIVITY_COOKIE);
    response.cookies.delete(ACTIVITY_COOKIE);
    return redirectToLogin(!isPublic);
  }

  if (activity === "write" && claims.sessionId) {
    response.cookies.set(
      ACTIVITY_COOKIE,
      createActivityValue(claims.sessionId, now, secret),
      ADMIN_COOKIE_OPTIONS,
    );
  }

  return applyHeaders(response);
}
