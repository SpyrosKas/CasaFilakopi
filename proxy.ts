import { type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { adminProxy } from "./lib/admin/proxy";
import { routing } from "./i18n/routing";

const publicSite = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  return request.nextUrl.pathname.startsWith("/admin")
    ? adminProxy(request)
    : publicSite(request);
}

export const config = {
  // Public pages and /admin. /api is never locale-prefixed.
  matcher: [
    "/admin",
    "/admin/:path*",
    "/((?!api|admin|_next|_vercel|.*\\..*).*)",
  ],
};
