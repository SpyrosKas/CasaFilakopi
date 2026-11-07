"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { setAdminLanguage } from "@/lib/admin/actions/language";
import type { AdminLanguage } from "@/lib/admin/i18n";

const CHOICES: { lang: AdminLanguage; short: string; name: string }[] = [
  { lang: "en", short: "EN", name: "English" },
  { lang: "el", short: "ΕΛ", name: "Ελληνικά" },
];

/** A plain form, so a phone on a poor connection can still switch. */
export function LanguageSwitch() {
  const { lang, t } = useAdminI18n();
  return (
    <form
      action={setAdminLanguage}
      className="language-switch"
      aria-label={t.common.language}
    >
      {CHOICES.map((choice) => (
        <button
          key={choice.lang}
          type="submit"
          name="lang"
          value={choice.lang}
          lang={choice.lang}
          aria-label={choice.name}
          aria-pressed={choice.lang === lang}
        >
          {choice.short}
        </button>
      ))}
    </form>
  );
}
