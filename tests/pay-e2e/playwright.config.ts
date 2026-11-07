import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";
import {
  FAKE_PUBLISHABLE_KEY,
  FAKE_SECRET_KEY,
  FAKE_WEBHOOK_SECRET,
} from "../support/fake-stripe";

// The payment flow in a real browser, against a dev server pointed at the local
// fake Stripe. Kept apart from tests/e2e, which runs with no Stripe keys, so the
// two never share a server. The room is this suite's own: see global-setup.ts.

const port = process.env.PORT ?? "3009";
const fakePort = process.env.FAKE_STRIPE_PORT ?? "12111";
const site = `http://localhost:${port}`;
export const PAY_ROOM_ID = process.env.PAY_TEST_ROOM_ID ?? randomUUID();
process.env.PAY_TEST_ROOM_ID = PAY_ROOM_ID;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 90_000,
  workers: 1,
  globalSetup: "./global-setup.ts",
  retries: 1,
  use: { baseURL: site, screenshot: "only-on-failure" },
  webServer: [
    {
      command: "pnpm exec tsx tests/support/fake-stripe-server.ts",
      cwd: "../..",
      port: Number(fakePort),
      reuseExistingServer: false,
      env: { FAKE_STRIPE_PORT: fakePort, PAY_SITE_URL: site },
    },
    {
      command: `pnpm dev --port ${port}`,
      cwd: "../..",
      url: `${site}/en`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SITE_URL: site,
        GUEST_TOKEN_SECRET: "pay-e2e-guest-token-secret-of-enough-length",
        STRIPE_SECRET_KEY: FAKE_SECRET_KEY,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
        STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
        STRIPE_API_HOST: "127.0.0.1",
        STRIPE_API_PORT: fakePort,
        STRIPE_API_PROTOCOL: "http",
        PAY_TEST_ROOM_ID: PAY_ROOM_ID,
        EMAIL_DEV_TRANSPORT: "memory",
      },
    },
  ],
});
