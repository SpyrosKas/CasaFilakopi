"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import { Dialog } from "./dialog";

/** "Read more" on a guest review. Reviews stay in the guest's own words. */
export function ReviewButton({
  label,
  title,
  text,
}: {
  label: string;
  title: string;
  text: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="link-button"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <Dialog label={title} onClose={() => setOpen(false)}>
          <div className="modal-body">
            <p lang={locale === "en" ? undefined : "en"}>{text}</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
