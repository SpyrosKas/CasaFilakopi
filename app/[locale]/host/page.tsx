import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Hero, HeroReserveButton } from "@/components/site/hero";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { RichInline } from "@/components/site/rich-text";
import { loadPage, pageMetadata } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Host" });
  return pageMetadata("host", locale, t("metaTitle"));
}

export default async function HostPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadPage("host", locale);
  const portrait = page.photo("host.portrait");

  return (
    <>
      <Hero
        image={page.photo("host.hero")?.src}
        title={page.text("hero", "title")}
        action={<HeroReserveButton />}
      />
      <section className="section" id="section-thehost">
        <div className="wrap host-layout">
          {portrait && (
            <div data-reveal="fade-up">
              <Photo
                {...portrait}
                className="host-photo"
                sizes="(min-width: 900px) 480px, 100vw"
              />
            </div>
          )}
          <p className="host-letter" data-reveal="fade-up">
            <RichInline text={page.text("letter", "body")} />
          </p>
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
