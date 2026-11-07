import { FakeStripe } from "./fake-stripe";

// The fake on a fixed port, for the browser tests. Started by
// tests/pay-e2e/playwright.config.ts. Local only.

const port = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
const site = process.env.PAY_SITE_URL ?? "http://localhost:3009";

const fake = new FakeStripe({
  port,
  webhookUrl: `${site}/api/stripe/webhook`,
});
void fake.start();
