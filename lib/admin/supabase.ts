import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_OPTIONS } from "@/lib/admin/config";
import type { Database } from "@/lib/db/types";
import { getPublicEnv } from "@/lib/env";

/**
 * The same client as lib/db/server.ts, with session cookies the browser's
 * scripts cannot read. Must match the client in lib/admin/proxy.ts.
 */
export async function createAdminSessionClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: ADMIN_COOKIE_OPTIONS,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // lib/admin/proxy.ts has already refreshed the session.
          }
        },
      },
    },
  );
}

export type AdminSessionClient = Awaited<
  ReturnType<typeof createAdminSessionClient>
>;
