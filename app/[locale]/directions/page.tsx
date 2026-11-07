import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { Accordion, AccordionLink } from "@/components/site/accordion";
import { Hero, HeroReserveButton } from "@/components/site/hero";
import { LineIcon, type LineIconName } from "@/components/site/line-icon";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { RichInline } from "@/components/site/rich-text";
import { loadPage, pageMetadata, type PageView } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Directions" });
  return pageMetadata("directions", locale, t("metaTitle"));
}

export default async function DirectionsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tCommon = await getTranslations("Common");
  const t = await getTranslations("Directions");
  const page = await loadPage("directions", locale);
  const picture = (number: number) => t("picture", { number });

  return (
    <>
      <Hero
        image={page.photo("directions.hero")?.src}
        welcome={page.text("hero", "welcome")}
        title={tCommon("siteName")}
        action={<HeroReserveButton />}
      />
      <section className="section directions" id="section-directions">
        <div className="wrap">
          <Accordion
            panels={[
              {
                id: "adamas",
                title: page.text("adamas", "title"),
                content: <Route page={page} route="adamas" picture={picture} />,
              },
              {
                id: "airport",
                title: page.text("airport", "title"),
                content: (
                  <Route
                    page={page}
                    route="airport"
                    picture={picture}
                    afterFirstStep={
                      <AccordionLink panelId="adamas">
                        {page.text("airport", "link")}
                      </AccordionLink>
                    }
                  />
                ),
              },
            ]}
          />
        </div>
      </section>
      <ReserveBand />
    </>
  );
}

function Route({
  page,
  route,
  picture,
  afterFirstStep,
}: {
  page: PageView;
  route: "adamas" | "airport";
  picture: (number: number) => string;
  afterFirstStep?: ReactNode;
}) {
  return (
    <ol className="steps">
      {page.items(route).map((step, index) => {
        const number = index + 1;
        const photo = page.photo(`step.${step.id}`);
        return (
          <li key={step.id} className="step" data-reveal="fade-up">
            <span className="step__number" aria-hidden="true">
              {number}
            </span>
            {photo && (
              <figure className="step__photo">
                <Photo {...photo} sizes="(min-width: 768px) 420px, 100vw" />
                <figcaption>{picture(number)}</figcaption>
              </figure>
            )}
            <div className="step__body">
              <span className="step__icon">
                <LineIcon
                  name={step.choice as LineIconName}
                  label={step.text("iconLabel")}
                />
              </span>
              <p>
                <RichInline text={step.text("text")} />
                {index === 0 && afterFirstStep && (
                  <>
                    <br /> {afterFirstStep}
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
