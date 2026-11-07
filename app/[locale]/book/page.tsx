import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/site/hero";
import { loadContact, loadPage, pageMetadata } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book" });
  return pageMetadata("book", locale, t("metaTitle"));
}

/** Placeholder entry point. Track PAY builds the booking flow here. */
export default async function BookPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Book");
  const page = await loadPage("book", locale);
  const contact = await loadContact(locale);

  return (
    <>
      <PageHero
        image={page.photo("page.hero")?.src}
        title={page.text("hero", "title")}
      />
      <section className="section">
        <div className="wrap page-content">
          <p className="lead">{page.text("main", "soon")}</p>
          <p>{page.text("main", "body")}</p>
          <p className="book-links">
            <a href={`mailto:${contact.email}`}>
              {t("emailLabel", { email: contact.email })}
            </a>
            <a href={contact.whatsappHref}>
              {t("whatsappLabel", { number: contact.whatsappDisplay })}
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
