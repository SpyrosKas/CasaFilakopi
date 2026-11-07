import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Hero, HeroReserveButton } from "@/components/site/hero";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { richTags } from "@/components/site/rich-text";
import { heroImages, hostPhoto } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Host" });
  return { title: t("metaTitle") };
}

export default function HostPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Host");

  return (
    <>
      <Hero
        image={heroImages.host}
        title={t("title")}
        action={<HeroReserveButton />}
      />
      <section className="section" id="section-thehost">
        <div className="wrap host-layout">
          <div data-reveal="fade-up">
            <Photo
              src={hostPhoto}
              alt={t("photoAlt")}
              className="host-photo"
              sizes="(min-width: 900px) 480px, 100vw"
            />
          </div>
          <p className="host-letter" data-reveal="fade-up">
            {t.rich("letter", richTags)}
          </p>
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
