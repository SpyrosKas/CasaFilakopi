import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use, type ReactNode } from "react";
import { Accordion, AccordionLink } from "@/components/site/accordion";
import { Hero, HeroReserveButton } from "@/components/site/hero";
import { Icon } from "@/components/site/icon";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { richTags } from "@/components/site/rich-text";
import { adamasSteps, airportSteps, type Step } from "@/content/directions";
import { heroImages } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Directions" });
  return { title: t("metaTitle") };
}

export default function DirectionsPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Directions");
  const tCommon = useTranslations("Common");

  return (
    <>
      <Hero
        image={heroImages.directions}
        welcome={t("welcome")}
        title={tCommon("siteName")}
        scrollTarget="section-directions"
        action={<HeroReserveButton />}
      />
      <section
        className="directions section bg-pattern host-section"
        id="section-directions"
      >
        <div className="container">
          <Accordion
            panels={[
              {
                id: "adamas",
                title: t("adamasTitle"),
                content: (
                  <Route
                    title={t("adamasTitle")}
                    route="adamas"
                    steps={adamasSteps}
                  />
                ),
              },
              {
                id: "airport",
                title: t("airportTitle"),
                content: (
                  <Route
                    title={t("airportTitle")}
                    route="airport"
                    steps={airportSteps}
                    afterFirstStep={
                      <AccordionLink panelId="adamas">
                        {t("airportLink")}
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
  title,
  route,
  steps,
  afterFirstStep,
}: {
  title: string;
  route: "adamas" | "airport";
  steps: Step[];
  afterFirstStep?: ReactNode;
}) {
  const t = useTranslations("Directions");
  return (
    <>
      <div className="page-header text-center">
        <h3>{title}</h3>
      </div>
      <ul className="timeline">
        {steps.map((step, index) => {
          const number = index + 1;
          const key = `${route}.${number}` as "adamas.1";
          const inverted = index % 2 === 1;
          const isLast = route === "adamas" && number === steps.length;
          return (
            <li
              key={number}
              className={inverted ? "timeline-inverted" : undefined}
              data-reveal={
                isLast ? "fade-up" : inverted ? "fade-left" : "fade-right"
              }
              data-reveal-delay={
                index === 0 ? undefined : inverted ? "1000" : "500"
              }
            >
              <div className="timeline-badge primary">
                <span title={t(`${key}.icon`)}>
                  <Icon name={step.icon} label={t(`${key}.icon`)} />
                </span>
              </div>
              <div className="timeline-panel">
                <div className="timeline-heading">
                  <Photo
                    className="img-responsive"
                    src={step.image}
                    alt={t("picture", { number })}
                    sizes="(min-width: 768px) 500px, 100vw"
                  />
                </div>
                <div className="timeline-body">
                  <p>
                    {t.rich(`${key}.text`, richTags)}
                    {index === 0 && afterFirstStep}
                  </p>
                </div>
                <div className="timeline-footer">
                  <span>{t("picture", { number })}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
