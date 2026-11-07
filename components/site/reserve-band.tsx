import { useTranslations } from "next-intl";
import Image from "next/image";
import { heroImages } from "@/content/house";
import { Link } from "@/i18n/navigation";
import { richTags } from "./rich-text";

/** The closing call to action above the footer. */
export function ReserveBand() {
  const t = useTranslations("Reserve");
  return (
    <section className="reserve-band">
      <div className="reserve-band__text">
        <div data-reveal="fade-up">
          <h2>{t.rich("title", richTags)}</h2>
          <Link href="/book" className="btn btn-light">
            {t("button")}
          </Link>
        </div>
      </div>
      <div className="reserve-band__photo">
        <Image
          src={heroImages.reserve}
          alt=""
          fill
          sizes="(min-width: 900px) 56vw, 100vw"
        />
      </div>
    </section>
  );
}
