import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * A secret-key client. Passed in rather than created here, so the queue and the
 * worker also run under tests, outside Next.js. lib/email/index.ts makes it.
 */
export type EmailDb = SupabaseClient<Database>;

export type EmailLogRow = Database["public"]["Tables"]["email_logs"]["Row"];
