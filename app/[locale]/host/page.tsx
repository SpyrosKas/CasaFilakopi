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
        scrollTarget="section-thehost"
        action={<HeroReserveButton />}
      />
      <section className="section bg-pattern host-section" id="section-thehost">
        <div className="container">
          <div className="row">
            <div className="col-md-7">
              <div className="container">
                <div className="row align-items-center">
                  <div
                    className="col-md-12 col-lg-12 ml-auto order-lg-2 position-relative mb-5"
                    data-reveal="fade-left"
                  >
                    <Photo
                      src={hostPhoto}
                      alt={t("photoAlt")}
                      className="img-fluid rounded"
                      sizes="(min-width: 768px) 60vw, 100vw"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="col-md-5">
              <div
                className="col-md-12 col-lg-12 order-lg-1"
                data-reveal="fade-right"
              >
                <p className="mb-4">{t.rich("letter", richTags)}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
