"use client";

import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";

/**
 * Replaces AOS. Any element with data-reveal="fade-up" (or fade, fade-left,
 * fade-right, fade-down) animates in as it enters the screen; styles/site.css
 * holds the motion and turns it off for prefers-reduced-motion.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const elements = document.querySelectorAll(
      "[data-reveal]:not([data-revealed])",
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -120px 0px" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
