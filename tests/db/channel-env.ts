import { execSync } from "node:child_process";

/** The local project's keys, from .env.local or, in CI, the Supabase CLI. */
export function localEnv(): { url: string; key: string; publishable: string } {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // CI runs these before it writes that file.
  }

  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SECRET_KEY;
  let publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || !publishable) {
    const status = execSync("supabase status -o env", { encoding: "utf8" });
    const read = (name: string) =>
      new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(status)?.[1] ?? "";
    url = read("API_URL");
    key = read("SECRET_KEY");
    publishable = read("PUBLISHABLE_KEY");
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    process.env.SUPABASE_SECRET_KEY = key;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = publishable;
  }
  process.env.NEXT_PUBLIC_SITE_URL ??= "http://localhost:3000";

  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error("Channel tests run against local Supabase only");
  }
  return { url, key, publishable };
}
