import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookingFlow } from "@/components/site/booking/booking-flow";
import { BookingMessages } from "@/components/site/booking/booking-messages";
import { PageHero } from "@/components/site/hero";
import { heroImages } from "@/content/house";
import { isValidIsoDate } from "@/lib/domain/dates";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book" });
  return { title: t("metaTitle") };
}

const date = (value: unknown) =>
  isValidIsoDate(value) ? value : (null as string | null);

const count = (value: unknown, min: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= 30
    ? number
    : undefined;
};

export default async function BookPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Book");
  const query = await searchParams;

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section">
        <div className="wrap book-page">
          <p className="book-intro">{t("intro")}</p>
          <BookingMessages>
            <BookingFlow
              initial={{
                checkIn: date(query.checkIn),
                checkOut: date(query.checkOut),
                adults: count(query.adults, 1),
                children: count(query.children, 0),
              }}
            />
          </BookingMessages>
        </div>
      </section>
    </>
  );
}
