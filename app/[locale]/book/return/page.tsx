import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookingMessages } from "@/components/site/booking/booking-messages";
import { ReturnStatus } from "@/components/site/booking/return-status";
import { PageHero } from "@/components/site/hero";
import { heroImages } from "@/content/house";
import { sessionIdSchema } from "@/lib/payments/schemas";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book.return" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function ReturnPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Book.return");
  const parsed = sessionIdSchema.safeParse((await searchParams).session_id);

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section">
        <div className="wrap book-page">
          <BookingMessages>
            <ReturnStatus sessionId={parsed.success ? parsed.data : null} />
          </BookingMessages>
        </div>
      </section>
    </>
  );
}
