import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  checkActivity,
  createActivityValue,
  readActivityValue,
} from "@/lib/admin/activity";
import { readClaims } from "@/lib/admin/claims";
import { ACTIVITY_COOKIE, ADMIN_COOKIE_OPTIONS } from "@/lib/admin/config";
import {
  createAdminSessionClient,
  type AdminSessionClient,
} from "@/lib/admin/supabase";
import type { Database } from "@/lib/db/types";
import { getServerEnv } from "@/lib/env.server";

export type AdminRole = Database["public"]["Enums"]["admin_role"];

interface SignedIn {
  supabase: AdminSessionClient;
  userId: string;
  email: string;
  role: AdminRole;
  displayName: string;
  hasTotp: boolean;
  /** When this session typed its password, in seconds. */
  signedInAt: number | null;
  /** True when this session came from a reset or invite link. */
  fromEmailLink: boolean;
}

export type AdminContext = SignedIn;

export type AdminSession =
  /** No session, or the session is over. */
  | { state: "anonymous"; expired: boolean }
  /** A real login with no admin_profiles row. Never gets past sign-in. */
  | { state: "not_admin"; supabase: AdminSessionClient }
  /** The password is done but the session still needs its TOTP code. */
  | ({ state: "needs_verify"; factorId: string } & SignedIn)
  /** An Owner who has not set up TOTP yet. */
  | ({ state: "needs_enrolment" } & SignedIn)
  | ({ state: "ready" } & SignedIn);

const EMAIL_LINK_METHODS = ["otp", "recovery", "invite"];

/** Records a sign-in. Call from an action or route, where cookies can be set. */
export async function markActive(accessToken: string): Promise<void> {
  const { sessionId } = readClaims(accessToken);
  if (!sessionId) return;
  const store = await cookies();
  store.set(
    ACTIVITY_COOKIE,
    createActivityValue(
      sessionId,
      Math.floor(Date.now() / 1000),
      getServerEnv().SUPABASE_SECRET_KEY,
    ),
    ADMIN_COOKIE_OPTIONS,
  );
}

export async function clearActive(): Promise<void> {
  (await cookies()).delete(ACTIVITY_COOKIE);
}

/**
 * Works out who is asking, from the server's view only. The token is checked
 * with the auth server and the role comes from the database, so nothing the
 * browser sends can raise it. Called on every page and server action.
 */
export const resolveAdminSession = cache(async (): Promise<AdminSession> => {
  const supabase = await createAdminSessionClient();

  // Only the token is read here. getUser checks it below, before any of it
  // is trusted.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { state: "anonymous", expired: false };

  const claims = readClaims(session.access_token);
  const store = await cookies();
  const activity = checkActivity({
    lastActive: claims.sessionId
      ? readActivityValue(
          store.get(ACTIVITY_COOKIE)?.value,
          claims.sessionId,
          getServerEnv().SUPABASE_SECRET_KEY,
        )
      : null,
    signedInAt: claims.signedInAt,
    now: Math.floor(Date.now() / 1000),
  });
  if (activity === "expired") return { state: "anonymous", expired: true };

  // Three independent questions, asked at once rather than one after another:
  // one trip instead of three on every click. Each answer is still checked
  // below in the same order, and none is used until getUser has passed.
  // admin_profiles has a self-read policy, so it works before TOTP is done.
  const [userResult, profileResult, roleResult] = await Promise.all([
    supabase.auth.getUser(session.access_token),
    supabase
      .from("admin_profiles")
      .select("id, role, display_name")
      .eq("id", claims.userId ?? "")
      .maybeSingle(),
    supabase.rpc("current_admin_role"),
  ]);

  const {
    data: { user },
    error,
  } = userResult;
  if (error || !user) return { state: "anonymous", expired: false };

  const profile = profileResult.data;
  if (!profile || profile.id !== user.id) {
    return { state: "not_admin", supabase };
  }

  const totp = (user.factors ?? []).find(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
  const signedIn: SignedIn = {
    supabase,
    userId: user.id,
    email: user.email ?? "",
    role: profile.role,
    displayName: profile.display_name,
    hasTotp: Boolean(totp),
    signedInAt: claims.signedInAt,
    fromEmailLink: claims.methods.some((m) => EMAIL_LINK_METHODS.includes(m)),
  };

  if (totp && claims.aal !== "aal2") {
    return { state: "needs_verify", factorId: totp.id, ...signedIn };
  }
  if (profile.role === "owner" && !totp) {
    return { state: "needs_enrolment", ...signedIn };
  }

  // Only the database decides. current_admin_role() is null for anyone with a
  // verified factor and no aal2, and for an Owner without aal2, so a forged or
  // stale state above cannot pass this.
  const { data: role, error: roleError } = roleResult;
  if (roleError || role !== profile.role) {
    return { state: "not_admin", supabase };
  }

  return { state: "ready", ...signedIn };
});

/** Use first in every admin page and server action. */
export async function requireAdmin(): Promise<AdminContext> {
  const session = await resolveAdminSession();
  switch (session.state) {
    case "ready":
      return session;
    case "needs_verify":
    case "needs_enrolment":
      redirect("/admin/mfa");
    case "anonymous":
      redirect(session.expired ? "/admin/login?expired=1" : "/admin/login");
    case "not_admin":
      redirect("/admin/login");
  }
}

/** Use first in every Owner page and server action. */
export async function requireOwner(): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (admin.role !== "owner") redirect("/admin/not-allowed");
  return admin;
}
