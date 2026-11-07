import {
  isLocalUrl,
  seedRefusal,
  stagingRefFrom,
} from "@/lib/invoicing/seed-guard";

// The import scripts write to the database and the media bucket, so they run
// only on purpose. They use the same rules as the invoice seed: local by
// default, staging only by naming its project. Production has its own flag.

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
  const productionRef = productionRefFrom(args);
  if (productionRef !== undefined) {
    return productionTarget(productionRef, shell);
  }
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

const isBadRef = (ref: string) => !/^[a-z0-9]{10,40}$/.test(ref);

const productionRefFrom = (args: string[]) =>
  args
    .find(
      (value) => value === "--production" || value.startsWith("--production="),
    )
    ?.slice("--production=".length);

/**
 * The one way to reach production (T7.2): the address and key must both come
 * from the shell, and the flag must name the same project as the address, so
 * neither a stale file nor a slip of the hand can pick the target.
 */
function productionTarget(
  ref: string,
  shell: MigrationEnv,
): MigrationTarget | { refusal: string } {
  const url = shell.NEXT_PUBLIC_SUPABASE_URL;
  if (isBadRef(ref)) {
    return { refusal: "Refusing to run: --production needs a project ref." };
  }
  if (!url || url.replace(/\/$/, "") !== `https://${ref}.supabase.co`) {
    return {
      refusal: `Refusing to run: NEXT_PUBLIC_SUPABASE_URL in your shell must be https://${ref}.supabase.co.`,
    };
  }
  if (!shell.SUPABASE_SECRET_KEY) {
    return {
      refusal:
        "Refusing to run: put the production secret key in SUPABASE_SECRET_KEY in your shell.",
    };
  }
  return { url, secretKey: shell.SUPABASE_SECRET_KEY };
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
