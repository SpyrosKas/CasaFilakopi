import "@/styles/site.css";

import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import { BookBar } from "@/components/site/book-bar";
import { CookieBanner } from "@/components/site/cookie-banner";
import { PreviewBanner } from "@/components/site/preview-banner";
import { RevealObserver } from "@/components/site/reveal-observer";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { routing } from "@/i18n/routing";
import { isPreviewing, loadContactForLayout } from "@/lib/cms/public";
import { indexable, siteOrigin } from "@/lib/seo";

// Publishing revalidates the pages it changes at once (WEB-08). This is only
// the safety net, for a page last rendered while the database was unreachable.
export const revalidate = 3600;

// Only the strings the browser needs: the page text stays on the server.
const clientNamespaces = ["Common", "Nav", "Consent", "Map", "Error"] as const;

// The two files each language shows first; unicode-range fetches the rest.
const firstFonts = {
  en: ["noto-serif-display-latin", "commissioner-latin"],
  el: ["noto-serif-display-greek", "commissioner-greek"],
} as const;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: { default: "Casa Filakopi", template: "%s | Casa Filakopi" },
  // Only production is indexed: see lib/security-headers.ts.
  robots: indexable() ? undefined : { index: false, follow: false },
  icons: { icon: "/img/casa-icon-1.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  for (const font of firstFonts[locale]) {
    preload(`/fonts/${font}-wght-normal.woff2`, {
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    });
  }

  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    clientNamespaces.map((namespace) => [namespace, messages[namespace]]),
  );
  const t = await getTranslations("Common");
  const contact = await loadContactForLayout(locale);
  const previewing = await isPreviewing();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={clientMessages}>
          <a className="skip-link" href="#main">
            {t("skipToContent")}
          </a>
          {previewing && <PreviewBanner />}
          <SiteHeader contact={contact} />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
          <BookBar />
          <CookieBanner />
          <RevealObserver />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
