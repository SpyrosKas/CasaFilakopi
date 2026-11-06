/**
 * Sent with every admin response. Next.js puts inline scripts and styles in
 * each page, and it cannot add a nonce to these without making every page
 * dynamic, so 'unsafe-inline' stays. In development only, Next.js also needs
 * eval and a websocket for hot reload.
 */
export function securityHeaders(
  supabaseUrl: string,
  isDevelopment: boolean,
): Record<string, string> {
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src 'self' ${new URL(supabaseUrl).origin}${isDevelopment ? " ws:" : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");

  return {
    "Content-Security-Policy": policy,
    // Browsers ignore this over plain http, so local work is unaffected. No
    // includeSubDomains: other subdomains of the domain are not ours to force.
    "Strict-Transport-Security": "max-age=31536000",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}
