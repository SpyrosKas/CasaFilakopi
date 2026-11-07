"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Dialog } from "./dialog";
import { LineIcon } from "./line-icon";
import { Photo } from "./photo";
import { useSnapTrack } from "./snap-track";

export type GalleryPhoto = { src: string; alt: string };

function ArrowButtons({
  onPrevious,
  onNext,
}: {
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("Common");
  return (
    <div className="arrows">
      <button type="button" aria-label={t("previous")} onClick={onPrevious}>
        <LineIcon name="arrowLeft" />
      </button>
      <button type="button" aria-label={t("next")} onClick={onNext}>
        <LineIcon name="arrowRight" />
      </button>
    </div>
  );
}

/** "2 / 6" on screen, a full sentence for screen readers. */
function Position({ index, total }: { index: number; total: number }) {
  const t = useTranslations("Common");
  return (
    <>
      <p className="position" aria-hidden="true">
        {index + 1} / {total}
      </p>
      <p className="sr-only" aria-live="polite">
        {t("photoStatus", { number: index + 1, total })}
      </p>
    </>
  );
}

/** Full-screen view. Swipes like the in-page strip; only mounted when open. */
function Lightbox({
  photos,
  label,
  startIndex,
  onClose,
}: {
  photos: GalleryPhoto[];
  label: string;
  startIndex: number;
  onClose: () => void;
}) {
  const total = photos.length;
  const { trackRef, index, showSlide } = useSnapTrack<HTMLUListElement>(total);

  useEffect(() => {
    showSlide(startIndex, true);
  }, [showSlide, startIndex]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "ArrowRight") showSlide(index + 1);
      if (event.key === "ArrowLeft") showSlide(index - 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showSlide, index]);

  return (
    <Dialog label={label} onClose={onClose} fullScreen>
      <div className="lightbox">
        <ul className="lightbox__track" ref={trackRef}>
          {photos.map((photo, i) => (
            <li key={photo.src}>
              <Photo
                src={photo.src}
                alt={photo.alt}
                sizes="100vw"
                loading={Math.abs(i - startIndex) <= 1 ? "eager" : "lazy"}
              />
            </li>
          ))}
        </ul>
        {total > 1 && (
          <div className="lightbox__controls">
            <Position index={index} total={total} />
            <ArrowButtons
              onPrevious={() => showSlide(index - 1)}
              onNext={() => showSlide(index + 1)}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * The photos of one part of the house, in the page rather than behind a button.
 * Swiping is plain CSS scroll-snap, so it works before the scripts load. There
 * is no auto-advance: nothing moves unless the visitor moves it.
 */
export function Gallery({
  photos,
  label,
  sizes,
  wide = false,
}: {
  photos: GalleryPhoto[];
  label: string;
  sizes: string;
  /** Runs from the page margin past the screen edge. */
  wide?: boolean;
}) {
  const t = useTranslations("Common");
  const total = photos.length;
  const { trackRef, index, showSlide } = useSnapTrack<HTMLUListElement>(total);
  const [openAt, setOpenAt] = useState<number | null>(null);

  const move = (next: number) => {
    const target = showSlide(next);
    trackRef.current?.children[target]
      ?.querySelector("button")
      ?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(index - 1);
    }
  };

  return (
    <div
      className={`gallery${wide ? " gallery--wide" : ""}`}
      role="group"
      aria-roledescription="carousel"
      aria-label={label}
    >
      {/* Arrow keys move between photos, so one Tab stop is enough. */}
      <ul className="gallery__track" ref={trackRef} onKeyDown={onKeyDown}>
        {photos.map((photo, i) => (
          <li key={photo.src} className="gallery__slide">
            <button
              type="button"
              className="gallery__open"
              aria-label={t("openPhoto", { alt: photo.alt })}
              tabIndex={i === index ? 0 : -1}
              onClick={() => setOpenAt(i)}
            >
              <Photo src={photo.src} alt="" sizes={sizes} />
            </button>
          </li>
        ))}
      </ul>
      {total > 1 && (
        <div className="gallery__controls">
          <Position index={index} total={total} />
          <ArrowButtons
            onPrevious={() => showSlide(index - 1)}
            onNext={() => showSlide(index + 1)}
          />
        </div>
      )}
      {openAt !== null && (
        <Lightbox
          photos={photos}
          label={label}
          startIndex={openAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </div>
  );
}

/** Thumbnails on the Gallery page; each opens the full-screen view there. */
export function GalleryGrid({
  title,
  photos,
}: {
  title: string;
  photos: GalleryPhoto[];
}) {
  const t = useTranslations("Common");
  const [openAt, setOpenAt] = useState<number | null>(null);
  return (
    <>
      <div className="gallery-grid">
        {photos.map((photo, index) => (
          <button
            key={photo.src}
            type="button"
            className="gallery-thumb"
            aria-label={t("openPhoto", { alt: photo.alt })}
            onClick={() => setOpenAt(index)}
          >
            <Photo
              src={photo.src}
              alt=""
              sizes="(min-width: 1024px) 300px, (min-width: 600px) 33vw, 50vw"
            />
          </button>
        ))}
      </div>
      {openAt !== null && (
        <Lightbox
          photos={photos}
          label={title}
          startIndex={openAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
