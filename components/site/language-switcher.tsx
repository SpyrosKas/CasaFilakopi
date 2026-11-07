"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export function LanguageSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const t = useTranslations("Common");
  const locale = useLocale();
  const pathname = usePathname();
  const other = locale === "en" ? "el" : "en";

  return (
    <Link
      href={pathname}
      locale={other}
      hrefLang={other}
      lang={other}
      aria-label={`${t("language")}: ${t("otherLanguageName")}`}
      onClick={onSwitch}
    >
      {t("otherLanguageName")}
    </Link>
  );
}
