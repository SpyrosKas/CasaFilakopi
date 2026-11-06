import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Public pages only. /admin and /api are never locale-prefixed.
  matcher: ["/((?!api|admin|_next|_vercel|.*\\..*).*)"],
};
