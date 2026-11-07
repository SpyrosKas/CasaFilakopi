"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { ADMIN_LANGUAGE_COOKIE, parseAdminLanguage } from "@/lib/admin/i18n";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** No sign-in needed: the login screens have the switch too. */
export async function setAdminLanguage(formData: FormData): Promise<void> {
  const store = await cookies();
  // Path / so the preview banner on the public site can read it too.
  store.set(ADMIN_LANGUAGE_COOKIE, parseAdminLanguage(formData.get("lang")), {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/admin", "layout");
}
