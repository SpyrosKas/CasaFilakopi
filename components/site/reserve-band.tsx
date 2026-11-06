import { useTranslations } from "next-intl";
import { heroImages } from "@/content/house";
import { Link } from "@/i18n/navigation";
import { richTags } from "./rich-text";

/** The dark "Reserve Now" band above the footer. */
export function ReserveBand() {
  const t = useTranslations("Reserve");
  return (
    <section
      className="section bg-image overlay"
      style={{ backgroundImage: `url(${heroImages.reserve})` }}
    >
      <div className="container">
        <div className="row align-items-center">
          <div
            className="col-12 col-md-6 text-center mb-4 mb-md-0 text-md-left"
            data-reveal="fade-up"
          >
            <h2 className="text-white font-weight-light">
              {/* The span takes the site-wide sans-serif, like the old <font>. */}
              <span>{t.rich("title", richTags)}</span>
            </h2>
          </div>
          <div
            className="col-12 col-md-6 text-center text-md-right"
            data-reveal="fade-up"
            data-reveal-delay="200"
          >
            <Link
              href="/book"
              className="btn btn-outline-white-primary py-3 text-white px-5"
            >
              {t("button")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
