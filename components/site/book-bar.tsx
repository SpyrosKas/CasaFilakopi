"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { useConsent } from "./consent-store";

// Anything that already offers the booking, or that the bar would sit on.
const covers = ".site-hero, .reserve-band, #site-footer";

/**
 * Phones have no room for Book in the header, so it waits at the bottom of the
 * screen once the hero's own button has scrolled away. CSS shows it below the
 * width where the header's Book button appears.
 */
export function BookBar() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const { bannerOpen } = useConsent();
  const [covered, setCovered] = useState(true);

  useEffect(() => {
    const inView = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target);
        else inView.delete(entry.target);
      }
      setCovered(inView.size > 0);
    });
    document.querySelectorAll(covers).forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  const shown = !covered && !bannerOpen && pathname !== "/book";

  return (
    <div className={`book-bar${shown ? " is-shown" : ""}`}>
      <Link href="/book" className="btn btn-primary">
        {t("book")}
      </Link>
    </div>
  );
}
