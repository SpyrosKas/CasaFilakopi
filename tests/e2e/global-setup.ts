import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Public pages read text and photos from the database, so a fresh database
// needs them imported before anything else runs. Both imports are safe to
// repeat. Only ever the local database.

export default function globalSetup() {
  const env = readFileSync(".env.local", "utf8");
  if (
    !/^NEXT_PUBLIC_SUPABASE_URL=http:\/\/(127\.0\.0\.1|localhost):/m.test(env)
  ) {
    throw new Error("End-to-end tests run against local Supabase only");
  }
  for (const script of ["migrate:content", "migrate:media"]) {
    execFileSync("pnpm", ["--silent", script], { stdio: "inherit" });
  }
}
