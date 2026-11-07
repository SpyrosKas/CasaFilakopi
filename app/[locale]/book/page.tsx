import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PageHero } from "@/components/site/hero";
import { contact } from "@/content/contact";
import { heroImages } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book" });
  return { title: t("metaTitle") };
}

/** Placeholder entry point. Track PAY builds the booking flow here. */
export default function BookPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Book");

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section bg-pattern">
        <div className="container">
          <div className="page-content text-center">
            <p className="mb-3">{t("soon")}</p>
            <p className="mb-3">{t("body")}</p>
            <p className="mb-0">
              <a href={`mailto:${contact.email}`}>
                {t("emailLabel", { email: contact.email })}
              </a>
            </p>
            <p>
              <a href={contact.whatsappHref}>
                {t("whatsappLabel", { number: contact.whatsappDisplay })}
              </a>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
