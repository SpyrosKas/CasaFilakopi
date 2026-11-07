"use client";

import { useEffect } from "react";
import { usePathname } from "@/i18n/navigation";

// Just under the failsafe delay in styles/site.css.
const FAILSAFE_MS = 2400;

/**
 * Replaces AOS. Any element with data-reveal="fade-up" (or fade, fade-left,
 * fade-right, fade-down) animates in as it enters the screen; styles/site.css
 * holds the motion and turns it off for prefers-reduced-motion. If this never
 * runs, a CSS failsafe shows the content anyway. First-view content uses
 * data-reveal-load instead, which needs no script at all.
 */
export function RevealObserver() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const elements = document.querySelectorAll(
      "[data-reveal]:not([data-revealed])",
    );

    // Slow load: the failsafe has shown (or is showing) everything already.
    // Taking over now would hide it again, so just mark it finished.
    if (
      !root.hasAttribute("data-reveal-active") &&
      performance.now() > FAILSAFE_MS
    ) {
      elements.forEach((element) => element.setAttribute("data-revealed", ""));
      return;
    }
    root.setAttribute("data-reveal-active", "");

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
