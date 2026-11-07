"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * State for a CSS scroll-snap strip. The browser does the swiping; this follows
 * which slide is nearest the middle and moves the strip for arrows and keys.
 */
export function useSnapTrack<T extends HTMLElement>(total: number) {
  const trackRef = useRef<T>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const middle = track.scrollLeft + track.clientWidth / 2;
      let nearest = 0;
      let nearestDistance = Infinity;
      [...track.children].forEach((child, i) => {
        const slide = child as HTMLElement;
        const center = slide.offsetLeft + slide.offsetWidth / 2;
        const distance = Math.abs(center - middle);
        if (distance < nearestDistance) {
          nearest = i;
          nearestDistance = distance;
        }
      });
      setIndex(nearest);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    // Swiping works before the scripts load, so the strip may already have moved.
    frame = requestAnimationFrame(measure);
    return () => {
      track.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  const showSlide = useCallback(
    (next: number, instant = false) => {
      const track = trackRef.current;
      if (!track) return 0;
      const target = (next + total) % total;
      const slide = track.children[target] as HTMLElement | undefined;
      if (!slide) return target;
      track.scrollTo({
        left: slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2,
        behavior: instant || prefersReducedMotion() ? "auto" : "smooth",
      });
      return target;
    },
    [total],
  );

  return { trackRef, index, showSlide };
}
