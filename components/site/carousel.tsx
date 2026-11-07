"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Photo } from "./photo";

export type CarouselPhoto = { src: string; alt: string };

const INTERVAL_MS = 5000;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Only ever mounted in the browser, inside an opened dialog. */
export function Carousel({
  photos,
  label,
  startIndex = 0,
}: {
  photos: CarouselPhoto[];
  label: string;
  startIndex?: number;
}) {
  const t = useTranslations("Common");
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [hovered, setHovered] = useState(false);
  const total = photos.length;

  useEffect(() => {
    if (!playing || hovered) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % total),
      INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [playing, hovered, total]);

  // A visitor choosing a photo wants to look at it: stop the auto-advance.
  const show = (next: number) => {
    setPlaying(false);
    setIndex((next + total) % total);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      setPlaying(false);
      const step = event.key === "ArrowRight" ? 1 : total - 1;
      setIndex((current) => (current + step) % total);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [total]);

  return (
    <div
      className="carousel slide carousel-fade"
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ol className="carousel-indicators">
        {photos.map((photo, i) => (
          <li key={photo.src} className={i === index ? "active" : undefined}>
            <button
              type="button"
              aria-label={t("showPhoto", { number: i + 1 })}
              aria-current={i === index ? "true" : undefined}
              onClick={() => show(i)}
            />
          </li>
        ))}
      </ol>
      <div className="carousel-inner">
        {photos.map((photo, i) => (
          <div
            key={photo.src}
            className={`carousel-item${i === index ? " active" : ""}`}
          >
            <Photo
              className="d-block w-100"
              src={photo.src}
              alt={photo.alt}
              sizes="(min-width: 576px) 500px, 100vw"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="carousel-control-prev"
        onClick={() => show(index - 1)}
      >
        <span className="carousel-control-prev-icon" aria-hidden="true" />
        <span className="sr-only">{t("previous")}</span>
      </button>
      <button
        type="button"
        className="carousel-control-next"
        onClick={() => show(index + 1)}
      >
        <span className="carousel-control-next-icon" aria-hidden="true" />
        <span className="sr-only">{t("next")}</span>
      </button>
      <button
        type="button"
        className="carousel-toggle"
        onClick={() => setPlaying(!playing)}
      >
        {playing ? t("pause") : t("play")}
      </button>
      <p className="sr-only" aria-live={playing ? "off" : "polite"}>
        {t("photoStatus", { number: index + 1, total })}
      </p>
    </div>
  );
}
