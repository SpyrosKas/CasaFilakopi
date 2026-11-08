import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GalleryGrid } from "@/components/site/gallery";
import { PageHero } from "@/components/site/hero";
import { ReserveBand } from "@/components/site/reserve-band";
import { loadPage, pageMetadata } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

const sections = [
  "welcome",
  "masterBedroom",
  "secondBedroom",
  "kitchen",
  "interiorBathroom",
  "exteriorBathroom",
  "coolOff",
];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Gallery" });
  return pageMetadata("gallery", locale, t("metaTitle"));
}

export default async function GalleryPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadPage("gallery", locale);
  const home = await loadPage("home", locale);

  return (
    <>
      <PageHero
        image={page.photo("page.hero")?.src}
        title={page.text("hero", "title")}
      />
      <section className="section">
        <div className="wrap">
          {sections.map((key) => {
            const title = home.text(key, "title");
            const photos = home.photos(`section.${key}`);
            if (photos.length === 0) return null;
            return (
              <div className="gallery-group" key={key}>
                <h2>{title}</h2>
                <GalleryGrid title={title} photos={photos} />
              </div>
            );
          })}
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
