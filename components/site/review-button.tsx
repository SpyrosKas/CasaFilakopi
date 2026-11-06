"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import { Dialog } from "./dialog";
import { Icon } from "./icon";

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
        className="btn btn-primary text-white py-2 mr-3"
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      {open && (
        <Dialog label={title} onClose={() => setOpen(false)}>
          <div className="modal-body">
            <i className="quote" aria-hidden="true">
              <Icon name="quoteLeft" />
            </i>
            <p lang={locale === "en" ? undefined : "en"}>{text}</p>
            <i className="quote" aria-hidden="true">
              <Icon name="quoteRight" />
            </i>
          </div>
        </Dialog>
      )}
    </>
  );
}
