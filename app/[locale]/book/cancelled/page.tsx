import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookingMessages } from "@/components/site/booking/booking-messages";
import { CancelledNotice } from "@/components/site/booking/cancelled-notice";
import { PageHero } from "@/components/site/hero";
import { loadPage } from "@/lib/cms/public";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book.cancelled" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

export default async function CancelledPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Book.cancelled");
  const hero = await loadPage("book", locale);
  const query = await searchParams;
  const again = new URLSearchParams({
    checkIn: text(query.checkIn),
    checkOut: text(query.checkOut),
    adults: text(query.adults),
    children: text(query.children),
  });

  return (
    <>
      <PageHero
        image={hero.photo("page.hero")?.src}
        focus={hero.photo("page.hero")?.focus}
        title={t("title")}
      />
      <section className="section">
        <div className="wrap book-page">
          <BookingMessages>
            <CancelledNotice
              releaseKey={text(query.key) || null}
              againQuery={again.toString()}
            />
          </BookingMessages>
        </div>
      </section>
    </>
  );
}
