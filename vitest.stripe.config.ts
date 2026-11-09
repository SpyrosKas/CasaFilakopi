import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Real Stripe test mode through `stripe listen`. Needs local Supabase, the
// Stripe CLI and a sandbox key: see tests/stripe/stripe-cli.test.ts.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["tests/stripe/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 90000,
  },
});
