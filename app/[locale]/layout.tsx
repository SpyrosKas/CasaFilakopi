import "@/styles/bootstrap.css";
import "@/styles/style.css";
import "@/styles/directions.css";
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
import { CookieBanner } from "@/components/site/cookie-banner";
import { RevealObserver } from "@/components/site/reveal-observer";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { routing } from "@/i18n/routing";

// Only the strings the browser needs: the page text stays on the server.
const clientNamespaces = ["Common", "Nav", "Consent", "Map", "Error"] as const;

export const metadata: Metadata = {
  title: { default: "Casa Filakopi", template: "%s | Casa Filakopi" },
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

  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    clientNamespaces.map((namespace) => [namespace, messages[namespace]]),
  );
  const t = await getTranslations("Common");

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={clientMessages}>
          <a className="skip-link" href="#main">
            {t("skipToContent")}
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
          <CookieBanner />
          <RevealObserver />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
