import { useTranslations } from "next-intl";
import Image from "next/image";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** The photo behind a hero: the first thing to load, and decoration only. */
function HeroPhoto({ image, focus }: { image?: string; focus?: string }) {
  if (!image) return null;
  return (
    <Image
      src={image}
      alt=""
      fill
      preload
      sizes="100vw"
      className="site-hero__photo"
      style={focus ? { objectPosition: focus } : undefined}
      data-backdrop=""
    />
  );
}

/** Full-screen hero of Home, The Host and Directions. */
export function Hero({
  image,
  focus,
  welcome,
  title,
  action,
  sky = false,
}: {
  image?: string;
  /** Ignored with `sky`, whose layout places the photo itself. */
  focus?: string;
  welcome?: string;
  title: string;
  action: ReactNode;
  /** The photo has open sky on the left: the title stands right on it. */
  sky?: boolean;
}) {
  return (
    <section className={`site-hero${sky ? " site-hero--sky" : ""}`}>
      <HeroPhoto image={image} focus={sky ? undefined : focus} />
      <div className="site-hero-inner" data-reveal-load="fade-up">
        <div className="site-hero__panel">
          <h1>
            {welcome && <span className="welcome">{welcome}</span>}
            <span className="main">{title}</span>
          </h1>
          {action}
        </div>
      </div>
    </section>
  );
}

export const heroButtonClass = "btn btn-light";

export function HeroReserveButton() {
  const t = useTranslations("Reserve");
  return (
    <Link href="/book" className={heroButtonClass}>
      {t("makeReservation")}
    </Link>
  );
}

/** Shorter hero for the new pages. */
export function PageHero({
  image,
  focus,
  title,
}: {
  image?: string;
  focus?: string;
  title: string;
}) {
  return (
    <section className="site-hero page-hero">
      <HeroPhoto image={image} focus={focus} />
      <div className="site-hero-inner" data-reveal-load="fade-up">
        <div className="site-hero__panel">
          <h1>
            <span className="main">{title}</span>
          </h1>
        </div>
      </div>
    </section>
  );
}
