import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { loadPage } from "@/lib/cms/public";
import { RichInline } from "./rich-text";

/** The closing call to action above the footer. */
export async function ReserveBand() {
  const t = await getTranslations("Reserve");
  const site = await loadPage("site", await getLocale());
  const photo = site.photo("reserve.band");
  return (
    <section className="reserve-band">
      <div className="reserve-band__text">
        <div data-reveal="fade-up">
          <h2>
            <RichInline text={site.text("reserve", "title")} />
          </h2>
          <Link href="/book" className="btn btn-light">
            {t("button")}
          </Link>
        </div>
      </div>
      <div className="reserve-band__photo">
        {photo && (
          <Image
            src={photo.src}
            alt=""
            fill
            sizes="(min-width: 900px) 56vw, 100vw"
            style={photo.focus ? { objectPosition: photo.focus } : undefined}
          />
        )}
      </div>
    </section>
  );
}
