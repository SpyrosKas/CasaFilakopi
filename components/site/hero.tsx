import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/** Full-screen hero of Home, The Host and Directions. */
export function Hero({
  image,
  welcome,
  title,
  action,
  scrollTarget,
}: {
  image: string;
  welcome?: string;
  title: string;
  action: ReactNode;
  scrollTarget: string;
}) {
  const t = useTranslations("Hero");
  return (
    <section
      className="site-hero overlay"
      style={{ backgroundImage: `url(${image})` }}
    >
      <div className="container">
        <div className="row site-hero-inner justify-content-center align-items-center">
          <div className="col-md-10 text-center">
            <div className="heading" data-reveal="fade-up">
              <h1>
                {welcome && <span className="welcome">{welcome}</span>}
                <span className="main">{title}</span>
              </h1>
            </div>
            <br />
            <p data-reveal="fade-up" data-reveal-delay="100">
              {action}
            </p>
          </div>
        </div>
        <a href={`#${scrollTarget}`} className="scroll-down">
          <div className="container">
            <div className="chevron" />
            <div className="chevron" />
            <div className="chevron" />
            <span className="text">{t("scrollDown")}</span>
          </div>
        </a>
      </div>
    </section>
  );
}

export const heroButtonClass =
  "btn uppercase btn-primary mr-md-2 mr-0 mb-3 d-sm-inline d-block";

export function HeroReserveButton() {
  const t = useTranslations("Reserve");
  return (
    <Link href="/book" className={heroButtonClass}>
      {t("makeReservation")}
    </Link>
  );
}

/** Shorter hero for the new pages. */
export function PageHero({ image, title }: { image: string; title: string }) {
  return (
    <section
      className="site-hero page-hero overlay"
      style={{ backgroundImage: `url(${image})` }}
    >
      <div className="container">
        <div className="row site-hero-inner justify-content-center align-items-center">
          <div className="col-md-10 text-center">
            <div className="heading" data-reveal="fade-up">
              <h1>
                <span className="main">{title}</span>
              </h1>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
