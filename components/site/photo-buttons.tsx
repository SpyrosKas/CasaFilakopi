"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Carousel, type CarouselPhoto } from "./carousel";
import { Dialog } from "./dialog";
import { Photo } from "./photo";

/** The "View more" button on the house sections. */
export function PhotoModalButton({
  label,
  title,
  photos,
}: {
  label: string;
  title: string;
  photos: CarouselPhoto[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary text-white py-2 mr-3"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <Dialog label={title} onClose={() => setOpen(false)}>
          <Carousel photos={photos} label={title} />
        </Dialog>
      )}
    </>
  );
}

/** Thumbnails on the Gallery page; each opens the carousel at that photo. */
export function GalleryGrid({
  title,
  photos,
}: {
  title: string;
  photos: CarouselPhoto[];
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
              sizes="(min-width: 992px) 220px, (min-width: 576px) 30vw, 50vw"
            />
          </button>
        ))}
      </div>
      {openAt !== null && (
        <Dialog label={title} onClose={() => setOpenAt(null)}>
          <Carousel photos={photos} label={title} startIndex={openAt} />
        </Dialog>
      )}
    </>
  );
}
