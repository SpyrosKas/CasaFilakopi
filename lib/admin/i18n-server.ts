import "server-only";
import { cookies } from "next/headers";
import {
  ADMIN_LANGUAGE_COOKIE,
  i18nFor,
  parseAdminLanguage,
  type AdminI18n,
  type AdminLanguage,
} from "@/lib/admin/i18n";

/** The language this person chose, or Greek. Works signed out too. */
export async function adminLanguage(): Promise<AdminLanguage> {
  const store = await cookies();
  return parseAdminLanguage(store.get(ADMIN_LANGUAGE_COOKIE)?.value);
}

/** Words and formats for this request. Call it inside the code that uses them. */
export async function adminI18n(): Promise<AdminI18n> {
  return i18nFor(await adminLanguage());
}
