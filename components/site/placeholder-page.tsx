import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { heroImages } from "@/content/house";
import { PageHero } from "./hero";
import { ReserveBand } from "./reserve-band";

export type PlaceholderPageKey =
  "faq" | "houseRules" | "privacy" | "terms" | "cancellation" | "cookies";

export async function placeholderMetadata(
  params: Promise<{ locale: string }>,
  page: PlaceholderPageKey,
): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Pages" });
  return { title: t(`${page}.title`) };
}

export function PlaceholderNotice() {
  const t = useTranslations("Placeholder");
  return (
    <div className="placeholder-notice" data-placeholder>
      <h2>{t("title")}</h2>
      <p>{t("body")}</p>
    </div>
  );
}

/**
 * Layout for pages whose text does not exist yet (FAQ, house rules, legal).
 * Nothing here may be invented: real content comes from the host, then Admin.
 */
export function PlaceholderPage({ page }: { page: PlaceholderPageKey }) {
  const t = useTranslations("Pages");
  return (
    <>
      <PageHero image={heroImages.page} title={t(`${page}.title`)} />
      <section className="section">
        <div className="wrap page-content">
          <PlaceholderNotice />
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
