import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomeAvailability } from "@/components/site/booking/home-availability";
import { Gallery } from "@/components/site/gallery";
import { heroButtonClass, Hero } from "@/components/site/hero";
import { Icon, type IconName } from "@/components/site/icon";
import { LineIcon, type LineIconName } from "@/components/site/line-icon";
import { LodgingJsonLd } from "@/components/site/lodging-json-ld";
import { Photo } from "@/components/site/photo";
import { ReserveBand } from "@/components/site/reserve-band";
import { ReviewButton } from "@/components/site/review-button";
import { RichInline } from "@/components/site/rich-text";
import {
  loadPage,
  loadPlaces,
  loadReviews,
  pageMetadata,
  type PageView,
} from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

const pairSizes = {
  large: "(min-width: 900px) 56vw, 88vw",
  small: "(min-width: 900px) 40vw, 88vw",
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Common" });
  const metadata = await pageMetadata("home", locale, t("siteName"));
  // Not "Casa Filakopi | Casa Filakopi".
  return { ...metadata, title: { absolute: metadata.title as string } };
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tCommon = await getTranslations("Common");
  const tHero = await getTranslations("Hero");
  const page = await loadPage("home", locale);
  const landscape = page.photo("home.landscape");

  return (
    <>
      <LodgingJsonLd locale={locale} />
      <Hero
        image={page.photo("home.hero")?.src}
        focus={page.photo("home.hero")?.focus}
        welcome={page.text("hero", "welcome")}
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
          <Room page={page} section="welcome" sizes={pairSizes.large} />
        </div>
      </section>

      <section className="section house-section house-tinted">
        <div className="wrap house-pair">
          <Room page={page} section="masterBedroom" sizes={pairSizes.large} />
          <Room page={page} section="secondBedroom" sizes={pairSizes.small} />
        </div>
      </section>

      <WideRoom page={page} section="kitchen" />

      <section className="section house-section house-tinted">
        <div className="wrap house-pair house-pair--flipped">
          <Room
            page={page}
            section="interiorBathroom"
            sizes={pairSizes.small}
          />
          <Room
            page={page}
            section="exteriorBathroom"
            sizes={pairSizes.large}
          />
        </div>
      </section>

      <WideRoom page={page} section="coolOff" />

      {landscape && (
        <figure className="full-bleed">
          <Photo {...landscape} sizes="100vw" />
        </figure>
      )}

      <section className="section visit-section">
        <div className="wrap visit-grid">
          <VisitBlock page={page} section="overall" />
          <VisitBlock page={page} section="places">
            <Places locale={locale} />
          </VisitBlock>
          <div className="visit-amenities" data-reveal="fade-up">
            <h2>{page.text("amenities", "title")}</h2>
            <ul className="amenities">
              {page.items("amenities").map((amenity) => (
                <li key={amenity.id}>
                  <LineIcon name={amenity.choice as LineIconName} />
                  <span>{amenity.text("label")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <HomeAvailability />
      <Reviews locale={locale} heading={page.text("reviews", "title")} />
      <ReserveBand />
    </>
  );
}

type RoomProps = { page: PageView; section: string };

function Room({ page, section, sizes }: RoomProps & { sizes: string }) {
  const title = page.text(section, "title");
  const photos = page.photos(`section.${section}`);
  return (
    <article className="room">
      {photos.length > 0 && (
        <div data-reveal="fade-up">
          <Gallery photos={photos} label={title} sizes={sizes} />
        </div>
      )}
      <div className="room__text" data-reveal="fade-up">
        <h2>{title}</h2>
        <p>
          <RichInline text={page.text(section, "body")} gap />
        </p>
      </div>
    </article>
  );
}

/** Heading and text on the margin, photos running off the edge of the screen. */
function WideRoom({ page, section }: RoomProps) {
  const title = page.text(section, "title");
  const photos = page.photos(`section.${section}`);
  return (
    <section className="section house-section house-wide">
      <div className="wrap room__text room__text--wide" data-reveal="fade-up">
        <h2>{title}</h2>
        <p>
          <RichInline text={page.text(section, "body")} gap />
        </p>
      </div>
      {photos.length > 0 && (
        <div data-reveal="fade-up">
          <Gallery
            photos={photos}
            label={title}
            sizes="(min-width: 900px) 70vw, 88vw"
            wide
          />
        </div>
      )}
    </section>
  );
}

function VisitBlock({
  page,
  section,
  children,
}: RoomProps & { children?: React.ReactNode }) {
  return (
    <div className="visit-block" data-reveal="fade-up">
      <h2>{page.text(section, "title")}</h2>
      <p>
        <RichInline text={page.text(section, "body")} />
      </p>
      {children}
    </div>
  );
}

/** The places Yorgos has published. There are none until he adds some. */
async function Places({ locale }: { locale: string }) {
  const places = await loadPlaces(locale);
  if (places.length === 0) return null;
  return (
    <ul className="visit-places">
      {places.map((place) => (
        <li key={place.id}>
          {place.photo && (
            <Photo {...place.photo} sizes="(min-width: 900px) 30vw, 88vw" />
          )}
          <strong>{place.name}</strong>
          {place.description && (
            <p>
              <RichInline text={place.description} />
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

async function Reviews({
  locale,
  heading,
}: {
  locale: string;
  heading: string;
}) {
  const t = await getTranslations("Reviews");
  const reviews = await loadReviews(locale);
  if (reviews.length === 0) return null;

  return (
    <section
      className="section testimonial-section"
      aria-labelledby="reviews-heading"
      data-reveal="fade"
    >
      <div className="wrap">
        <h2 id="reviews-heading">{heading}</h2>
        <div className="reviews">
          {reviews.map((review) => (
            <article className="box" key={review.id}>
              <Stars
                stars={review.stars}
                label={t("starsLabel", { stars: String(review.stars) })}
              />
              <blockquote lang={review.textLang}>
                <p>{review.teaser}</p>
              </blockquote>
              <p className="name">{review.author}</p>
              <ReviewButton
                label={t("readMore")}
                title={t("reviewBy", { name: review.author })}
                text={review.text}
                textLang={review.textLang}
              />
            </article>
          ))}
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
