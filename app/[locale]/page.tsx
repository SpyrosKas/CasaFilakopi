import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { heroButtonClass, Hero } from "@/components/site/hero";
import { Icon, type IconName } from "@/components/site/icon";
import { Photo } from "@/components/site/photo";
import { PhotoModalButton } from "@/components/site/photo-buttons";
import { ReserveBand } from "@/components/site/reserve-band";
import { ReviewButton } from "@/components/site/review-button";
import { richTags } from "@/components/site/rich-text";
import {
  heroImages,
  houseSections,
  photoKey,
  reviews,
  type HouseSection,
} from "@/content/house";

export default function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");
  const tCommon = useTranslations("Common");

  return (
    <>
      <Hero
        image={heroImages.home}
        welcome={t("welcomeTo")}
        title={tCommon("siteName")}
        scrollTarget="section-housestructure"
        action={
          <a href="#section-housestructure" className={heroButtonClass}>
            <ExploreLabel />
          </a>
        }
      />
      {houseSections.map((section, index) => (
        <HouseSectionBlock
          key={section.key}
          section={section}
          id={index === 0 ? "section-housestructure" : undefined}
        />
      ))}
      <section className="section visit-section">
        <div className="container">
          <VisitBlock title={t("overallTitle")} body={t("overallBody")} />
          <VisitBlock
            title={t("amenitiesTitle")}
            body={t("amenitiesBody")}
            spaced
          />
          <VisitBlock title={t("placesTitle")} body={t("placesBody")} />
        </div>
      </section>
      <Reviews locale={locale} />
      <ReserveBand />
    </>
  );
}

function ExploreLabel() {
  const t = useTranslations("Hero");
  return t("explore");
}

function HouseSectionBlock({
  section,
  id,
}: {
  section: HouseSection;
  id?: string;
}) {
  const t = useTranslations("Home");
  const tPhotos = useTranslations("Photos");
  const { key, photoSide, photo, round, slides } = section;
  const title = t(`sections.${key}.title`);
  const photoRight = photoSide === "right";

  const mediaClass = photoRight
    ? "col-md-12 col-lg-7 ml-auto order-lg-2 position-relative mb-5"
    : "col-md-12 col-lg-7 order-lg-1 house-media";
  const textClass = photoRight
    ? "col-md-12 col-lg-4 order-lg-1"
    : "col-md-12 col-lg-4 ml-auto order-lg-2 position-relative mb-5";

  return (
    <section className="section house-section" id={id}>
      <div className="container">
        <div className="row align-items-center">
          <div className={mediaClass} data-reveal="fade-up">
            <figure className="img-absolute">
              <Photo
                src={round}
                alt={t(`sections.${key}.roundAlt`)}
                className="img-fluid"
                sizes="250px"
                data-reveal={photoRight ? "fade-left" : "fade-right"}
              />
            </figure>
            <Photo
              src={photo}
              alt={t(`sections.${key}.alt`)}
              className="img-fluid rounded"
              sizes="(min-width: 1200px) 635px, (min-width: 992px) 530px, 100vw"
            />
          </div>
          <div className={textClass} data-reveal="fade-up">
            <h2 className="heading">{title}</h2>
            <p className="mb-4">{t.rich(`sections.${key}.body`, richTags)}</p>
            {slides.length > 0 && (
              <div className="mb-3">
                <PhotoModalButton
                  label={t("viewMore")}
                  title={title}
                  photos={slides.map((src) => ({
                    src,
                    alt: tPhotos(photoKey(src)),
                  }))}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function VisitBlock({
  title,
  body,
  spaced = false,
}: {
  title: string;
  body: string;
  spaced?: boolean;
}) {
  return (
    <div className="row">
      <div className="col-md-12">
        <h2 className="heading" data-reveal="fade-right">
          {title}
        </h2>
        <p data-reveal="fade-left">
          {body}
          {spaced && (
            <>
              <br />
              <br />
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Reviews({ locale }: { locale: string }) {
  const t = useTranslations("Reviews");
  // Guest reviews are quotes, so they stay in the guest's own language.
  const reviewLang = locale === "en" ? undefined : "en";

  return (
    <section
      className="section testimonial-section"
      aria-label={t("heading")}
      data-reveal="fade"
      data-reveal-delay="200"
    >
      <div className="container">
        <div className="wrapper">
          {reviews.map(({ key, stars, reveal, delay }) => {
            const name = t(`items.${key}.name`);
            return (
              <div
                className="box"
                key={key}
                data-reveal={reveal}
                data-reveal-delay={delay}
              >
                <i className="quote" aria-hidden="true">
                  <Icon name="quoteLeft" />
                </i>
                <p lang={reviewLang}>
                  {t(`items.${key}.teaser`)}{" "}
                  <i className="quote" aria-hidden="true">
                    <Icon name="quoteRight" />
                  </i>
                </p>
                <div className="mb-3">
                  <ReviewButton
                    label={t("readMore")}
                    title={t("reviewBy", { name })}
                    text={t(`items.${key}.text`)}
                  />
                </div>
                <div className="content">
                  <div className="info">
                    <div className="name">{name}</div>
                    <Stars
                      stars={stars}
                      label={t("starsLabel", { stars: String(stars) })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Stars({ stars, label }: { stars: number; label: string }) {
  const icons: IconName[] = Array.from({ length: Math.ceil(stars) }, (_, i) =>
    i + 1 <= stars ? "star" : "starHalf",
  );
  return (
    <div className="stars" role="img" aria-label={label}>
      {icons.map((name, index) => (
        <i key={index}>
          <Icon name={name} />{" "}
        </i>
      ))}
    </div>
  );
}
