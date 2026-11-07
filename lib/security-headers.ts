// Headers for every public page and route (T6.3, PLT-05). The admin panel has
// its own, stricter set in lib/admin/headers.ts. Used by next.config.ts, so this
// file imports nothing from the app.
//
// 'unsafe-inline' stays in script-src for the same reason as in the admin: the
// public pages are static, and Next.js cannot put a nonce in a static page.
// Everything else names exactly what the site needs:
// - Google Maps, in a frame, only after consent.
// - Cloudflare Turnstile: its script, and its challenge in a frame.
// - Stripe hosted Checkout, reached by a redirect after a form post, which is
//   what form-action governs. Stripe's own pages run on Stripe's own policy.
// - Photos: the image optimiser fetches them on the server, so the browser
//   only ever loads them from this site.

const TURNSTILE = "https://challenges.cloudflare.com";
const GOOGLE_MAPS = "https://www.google.com";
const STRIPE_CHECKOUT = "https://checkout.stripe.com";

export function publicContentSecurityPolicy(isDevelopment: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE}${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${isDevelopment ? " ws:" : ""}`,
    `frame-src ${GOOGLE_MAPS} ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${STRIPE_CHECKOUT}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

export function publicSecurityHeaders(
  isDevelopment: boolean,
  indexable: boolean,
): { key: string; value: string }[] {
  return [
    {
      key: "Content-Security-Policy",
      value: publicContentSecurityPolicy(isDevelopment),
    },
    // No includeSubDomains: other subdomains are not ours to force (see admin).
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    ...(indexable ? [] : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]),
  ];
}

const PRODUCTION_HOSTS = ["miloscasa.com", "www.miloscasa.com"];

/**
 * Only production is indexed. Staging and previews carry noindex, decided from
 * the environment so a copied deployment cannot end up in search results by
 * accident. On Vercel the deployment itself must be production, whatever its
 * address says. Then it takes the production host, or NEXT_PUBLIC_INDEXABLE=true.
 */
export function isIndexable(
  siteUrl: string | undefined,
  flag: string | undefined,
  vercelEnv: string | undefined,
): boolean {
  if (vercelEnv && vercelEnv !== "production") return false;
  if (flag === "true") return true;
  if (!siteUrl || !URL.canParse(siteUrl)) return false;
  return PRODUCTION_HOSTS.includes(new URL(siteUrl).hostname);
}
