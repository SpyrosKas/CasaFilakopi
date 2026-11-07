"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

type Locale = (typeof routing.locales)[number];

/** Inline SVG, because emoji flags do not render on Windows. */
function GreeceFlag() {
  return (
    <svg
      className="lang__flag"
      viewBox="0 0 27 18"
      width="21"
      height="14"
      aria-hidden="true"
    >
      <rect width="27" height="18" fill="#0d5eaf" />
      <path
        d="M10 3h17M10 7h17M0 11h27M0 15h27M5 0v10M0 5h10"
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}

function UkFlag() {
  return (
    <svg
      className="lang__flag"
      viewBox="0 0 60 40"
      width="21"
      height="14"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect y="-5" width="60" height="50" fill="#012169" />
      <path d="M-5 -2.5 65 42.5M65 -2.5-5 42.5" stroke="#fff" strokeWidth="8" />
      <path
        d="M-5 -2.5 65 42.5M65 -2.5-5 42.5"
        stroke="#c8102e"
        strokeWidth="3"
      />
      <path d="M30-5v50M-5 20h70" stroke="#fff" strokeWidth="13" />
      <path d="M30-5v50M-5 20h70" stroke="#c8102e" strokeWidth="8" />
    </svg>
  );
}

const flags = { el: GreeceFlag, en: UkFlag } satisfies Record<
  Locale,
  () => React.JSX.Element
>;

/**
 * Both languages stay on screen, so nobody has to find a hidden list. Each is a
 * plain link to the same page, which also works before the scripts load.
 */
export function LanguageSwitcher({ onSwitch }: { onSwitch?: () => void }) {
  const t = useTranslations("Common");
  const locale = useLocale();
  const pathname = usePathname();
  const names: Record<Locale, string> =
    locale === "en"
      ? { en: t("languageName"), el: t("otherLanguageName") }
      : { el: t("languageName"), en: t("otherLanguageName") };

  return (
    <nav className="lang" aria-label={t("language")}>
      <ul>
        {(["el", "en"] as const).map((option) => {
          const Flag = flags[option];
          return (
            <li key={option}>
              <Link
                href={pathname}
                locale={option}
                hrefLang={option}
                lang={option}
                aria-label={names[option]}
                aria-current={option === locale ? "true" : undefined}
                onClick={onSwitch}
              >
                <Flag />
                <span aria-hidden="true">{option.toUpperCase()}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
