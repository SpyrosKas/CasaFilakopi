import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { HomeAvailability } from "@/components/site/booking/home-availability";
import { Gallery } from "@/components/site/gallery";
import { heroButtonClass, Hero } from "@/components/site/hero";
import { Icon, type IconName } from "@/components/site/icon";
import { LineIcon, type LineIconName } from "@/components/site/line-icon";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { ReviewButton } from "@/components/site/review-button";
import { richTags } from "@/components/site/rich-text";
import {
  heroImages,
  houseSections,
  landscapePhoto,
  photoKey,
  reviews,
  type HouseSection,
  type HouseSectionKey,
} from "@/content/house";

/** In the order of Home.amenitiesBody, which lists them separated by commas. */
const amenityIcons: LineIconName[] = [
  "hammock",
  "shower",
  "flame",
  "snowflake",
  "wifi",
  "tv",
  "wind",
  "yogaMat",
  "waves",
  "towels",
];

const pairSizes = {
  large: "(min-width: 900px) 56vw, 88vw",
  small: "(min-width: 900px) 40vw, 88vw",
};

function sectionFor(key: HouseSectionKey) {
  return houseSections.find((section) => section.key === key)!;
}

export default function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");
  const tCommon = useTranslations("Common");
  const tHero = useTranslations("Hero");
  const tPhotos = useTranslations("Photos");

  return (
    <>
      <Hero
        image={heroImages.home}
        welcome={t("welcomeTo")}
        title={tCommon("siteName")}
        sky
        action={
          <a href="#section-housestructure" className={heroButtonClass}>
            {tHero("explore")}
          </a>
        }
      />

      <section
        className="section house-section house-intro"
        id="section-housestructure"
      >
        <div className="wrap">
          <Room section={sectionFor("welcome")} sizes={pairSizes.large} />
        </div>
      </section>

      <section className="section house-section house-tinted">
        <div className="wrap house-pair">
          <Room section={sectionFor("masterBedroom")} sizes={pairSizes.large} />
          <Room section={sectionFor("secondBedroom")} sizes={pairSizes.small} />
        </div>
      </section>

      <WideRoom section={sectionFor("kitchen")} />

      <section className="section house-section house-tinted">
        <div className="wrap house-pair house-pair--flipped">
          <Room
            section={sectionFor("interiorBathroom")}
            sizes={pairSizes.small}
          />
          <Room
            section={sectionFor("exteriorBathroom")}
            sizes={pairSizes.large}
          />
        </div>
      </section>

      <WideRoom section={sectionFor("coolOff")} />

      <figure className="full-bleed">
        <Photo
          src={landscapePhoto}
          alt={tPhotos(photoKey(landscapePhoto))}
          sizes="100vw"
        />
      </figure>

      <section className="section visit-section">
        <div className="wrap visit-grid">
          <VisitBlock title={t("overallTitle")} body={t("overallBody")} />
          <VisitBlock title={t("placesTitle")} body={t("placesBody")} />
          <div className="visit-amenities" data-reveal="fade-up">
            <h2>{t("amenitiesTitle")}</h2>
            <ul className="amenities">
              {t("amenitiesBody")
                .split(/,\s*/)
                .map((amenity, index) => (
                  <li key={amenity}>
                    {amenityIcons[index] && (
                      <LineIcon name={amenityIcons[index]} />
                    )}
                    <span>{amenity}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>

      <HomeAvailability />
      <Reviews locale={locale} />
      <ReserveBand />
    </>
  );
}

function useRoom(section: HouseSection) {
  const t = useTranslations("Home");
  const tPhotos = useTranslations("Photos");
  const { key, photo, slides, mainPhotoLast } = section;
  const main = { src: photo, alt: t(`sections.${key}.alt`) };
  const rest = slides.map((src) => ({ src, alt: tPhotos(photoKey(src)) }));
  return {
    title: t(`sections.${key}.title`),
    body: t.rich(`sections.${key}.body`, {
      ...richTags,
      br: () => <span className="paragraph-gap" />,
    }),
    photos: mainPhotoLast ? [...rest, main] : [main, ...rest],
  };
}

function Room({ section, sizes }: { section: HouseSection; sizes: string }) {
  const { title, body, photos } = useRoom(section);
  return (
    <article className="room">
      <div data-reveal="fade-up">
        <Gallery photos={photos} label={title} sizes={sizes} />
      </div>
      <div className="room__text" data-reveal="fade-up">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </article>
  );
}

/** Heading and text on the margin, photos running off the edge of the screen. */
function WideRoom({ section }: { section: HouseSection }) {
  const { title, body, photos } = useRoom(section);
  return (
    <section className="section house-section house-wide">
      <div className="wrap room__text room__text--wide" data-reveal="fade-up">
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <div data-reveal="fade-up">
        <Gallery
          photos={photos}
          label={title}
          sizes="(min-width: 900px) 70vw, 88vw"
          wide
        />
      </div>
    </section>
  );
}

function VisitBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="visit-block" data-reveal="fade-up">
      <h2>{title}</h2>
      <p>{body}</p>
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
      aria-labelledby="reviews-heading"
      data-reveal="fade"
    >
      <div className="wrap">
        <h2 id="reviews-heading">{t("heading")}</h2>
        <div className="reviews">
          {reviews.map(({ key, stars }) => {
            const name = t(`items.${key}.name`);
            return (
              <article className="box" key={key}>
                <Stars
                  stars={stars}
                  label={t("starsLabel", { stars: String(stars) })}
                />
                <blockquote lang={reviewLang}>
                  <p>{t(`items.${key}.teaser`)}</p>
                </blockquote>
                <p className="name">{name}</p>
                <ReviewButton
                  label={t("readMore")}
                  title={t("reviewBy", { name })}
                  text={t(`items.${key}.text`)}
                />
              </article>
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
        <Icon key={index} name={name} />
      ))}
    </div>
  );
}
