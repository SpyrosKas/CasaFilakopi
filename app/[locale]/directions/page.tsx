import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use, type ReactNode } from "react";
import { Accordion, AccordionLink } from "@/components/site/accordion";
import { Hero, HeroReserveButton } from "@/components/site/hero";
import { LineIcon, type LineIconName } from "@/components/site/line-icon";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { richTags } from "@/components/site/rich-text";
import {
  adamasSteps,
  airportSteps,
  type Step,
  type StepIcon,
} from "@/content/directions";
import { heroImages } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

const stepIcons: Record<StepIcon, LineIconName> = {
  arrowCircleRight: "turnRight",
  arrowCircleLeft: "turnLeft",
  arrowCircleUp: "arrowUp",
  smileBeam: "smile",
};

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
        action={<HeroReserveButton />}
      />
      <section className="section directions" id="section-directions">
        <div className="wrap">
          <Accordion
            panels={[
              {
                id: "adamas",
                title: t("adamasTitle"),
                content: <Route route="adamas" steps={adamasSteps} />,
              },
              {
                id: "airport",
                title: t("airportTitle"),
                content: (
                  <Route
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
  route,
  steps,
  afterFirstStep,
}: {
  route: "adamas" | "airport";
  steps: Step[];
  afterFirstStep?: ReactNode;
}) {
  const t = useTranslations("Directions");
  return (
    <ol className="steps">
      {steps.map((step, index) => {
        const number = index + 1;
        const key = `${route}.${number}` as "adamas.1";
        return (
          <li key={number} className="step" data-reveal="fade-up">
            <span className="step__number" aria-hidden="true">
              {number}
            </span>
            <figure className="step__photo">
              <Photo
                src={step.image}
                alt={t(`${key}.alt`)}
                sizes="(min-width: 768px) 420px, 100vw"
              />
              <figcaption>{t("picture", { number })}</figcaption>
            </figure>
            <div className="step__body">
              <span className="step__icon">
                <LineIcon
                  name={stepIcons[step.icon]}
                  label={t(`${key}.icon`)}
                />
              </span>
              <p>
                {t.rich(`${key}.text`, richTags)}
                {index === 0 && afterFirstStep}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
