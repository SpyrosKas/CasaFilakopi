/** Exact origins, scheme included. Same rule as /api/contact and /api/consent. */
export function allowedOrigins(request: Request): string[] {
  const origins: string[] = [];
  const add = (url: string | undefined) => {
    if (url && URL.canParse(url)) origins.push(new URL(url).origin);
  };
  add(process.env.NEXT_PUBLIC_SITE_URL);
  if (process.env.VERCEL_URL) add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) {
    add(`https://${process.env.VERCEL_BRANCH_URL}`);
  }
  if (process.env.NODE_ENV !== "production") {
    add(`http://${request.headers.get("host")}`);
  }
  return origins;
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !!origin && allowedOrigins(request).includes(origin);
}
