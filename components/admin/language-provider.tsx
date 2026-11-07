"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_ADMIN_LANGUAGE,
  i18nFor,
  type AdminI18n,
  type AdminLanguage,
} from "@/lib/admin/i18n";

const Language = createContext<AdminLanguage>(DEFAULT_ADMIN_LANGUAGE);

/** Set once in the admin root layout, from the cookie read on the server. */
export function AdminLanguageProvider({
  lang,
  children,
}: {
  lang: AdminLanguage;
  children: ReactNode;
}) {
  return <Language.Provider value={lang}>{children}</Language.Provider>;
}

export function useAdminI18n(): AdminI18n {
  return i18nFor(useContext(Language));
}
