import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { PageHero } from "@/components/site/hero";
import { GalleryGrid } from "@/components/site/photo-buttons";
import { ReserveBand } from "@/components/site/reserve-band";
import { heroImages, houseSections, photoKey } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Gallery" });
  return { title: t("metaTitle") };
}

export default function GalleryPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Gallery");
  const tHome = useTranslations("Home");
  const tPhotos = useTranslations("Photos");

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section bg-pattern">
        <div className="container">
          {houseSections.map(({ key, photo, slides }) => {
            const title = tHome(`sections.${key}.title`);
            return (
              <div className="gallery-group" key={key}>
                <h2>{title}</h2>
                <GalleryGrid
                  title={title}
                  photos={[
                    { src: photo, alt: tHome(`sections.${key}.alt`) },
                    ...slides.map((src) => ({
                      src,
                      alt: tPhotos(photoKey(src)),
                    })),
                  ]}
                />
              </div>
            );
          })}
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
