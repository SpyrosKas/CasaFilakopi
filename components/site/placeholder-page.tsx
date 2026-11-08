import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { loadPage, pageMetadata } from "@/lib/cms/public";
import { PageHero } from "./hero";
import { ReserveBand } from "./reserve-band";
import { RichBlocks } from "./rich-text";

export type TextPageSlug =
  "faq" | "house-rules" | "privacy" | "terms" | "cancellation" | "cookies";

export async function textPageMetadata(
  params: Promise<{ locale: string }>,
  slug: TextPageSlug,
): Promise<Metadata> {
  const { locale } = await params;
  const page = await loadPage(slug, locale);
  return pageMetadata(slug, locale, page.text("hero", "title"));
}

export async function PlaceholderNotice() {
  const t = await getTranslations("Placeholder");
  return (
    <div className="placeholder-notice" data-placeholder>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
    </div>
  );
}

/** Hero, the page's content, and the band that closes every page. */
export async function TextPageFrame({
  slug,
  locale,
  children,
}: {
  slug: TextPageSlug;
  locale: string;
  children: ReactNode;
}) {
  const page = await loadPage(slug, locale);
  return (
    <>
      <PageHero
        image={page.photo("page.hero")?.src}
        title={page.text("hero", "title")}
      />
      <section className="section">
        <div className="wrap page-content">{children}</div>
      </section>
      <ReserveBand />
    </>
  );
}

/**
 * House rules and legal pages. Text comes from the host through Admin and is
 * never invented: until it is published in this language, the page says so.
 */
export async function TextPage({
  slug,
  locale,
}: {
  slug: TextPageSlug;
  locale: string;
}) {
  const page = await loadPage(slug, locale);
  const body = page.text("main", "body");
  return (
    <TextPageFrame slug={slug} locale={locale}>
      {body.trim() ? <RichBlocks text={body} /> : <PlaceholderNotice />}
    </TextPageFrame>
  );
}
