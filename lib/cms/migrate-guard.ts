import {
  isLocalUrl,
  seedRefusal,
  stagingRefFrom,
} from "@/lib/invoicing/seed-guard";

// The import scripts write to the database and the media bucket, so they run
// only on purpose and never near production. They use the same rules as the
// invoice seed: local by default, staging only by naming its project.

export interface MigrationTarget {
  url: string;
  secretKey: string;
}

export interface MigrationEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  APP_ENV?: string;
}

/**
 * Reads .env.local only for what the shell did not set, so a key supplied by
 * the operator always wins. A hosted project must have its key in the shell,
 * so a local key from the file can never be sent to the wrong place.
 */
export function resolveTarget(
  args: string[],
  shell: MigrationEnv,
  file: MigrationEnv,
): MigrationTarget | { refusal: string } {
  const url = shell.NEXT_PUBLIC_SUPABASE_URL ?? file.NEXT_PUBLIC_SUPABASE_URL;
  const refusal = seedRefusal({
    supabaseUrl: url ?? "",
    names: [shell.VERCEL_ENV, shell.NODE_ENV, shell.APP_ENV],
    stagingRef: stagingRefFrom(args),
  });
  if (refusal) return { refusal };

  const hosted = !isLocalUrl(url!);
  const secretKey =
    shell.SUPABASE_SECRET_KEY ??
    (hosted ? undefined : file.SUPABASE_SECRET_KEY);
  if (!secretKey) {
    return {
      refusal: hosted
        ? "Refusing to run: put the staging secret key in SUPABASE_SECRET_KEY in your shell. It is never read from a file for a hosted project."
        : "Refusing to run: SUPABASE_SECRET_KEY is not set.",
    };
  }
  return { url: url!, secretKey };
}

/** The values in .env.local, without changing the environment. */
export function readEnvFile(text: string): MigrationEnv {
  const values: Record<string, string> = {};
  for (const row of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(row);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}
