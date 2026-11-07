"use client";

import { useState } from "react";
import { Dialog } from "./dialog";

/** "Read more" on a guest review. Reviews stay in the guest's own words. */
export function ReviewButton({
  label,
  title,
  text,
  textLang,
}: {
  label: string;
  title: string;
  text: string;
  textLang?: string;
}) {
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
            <p lang={textLang}>{text}</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
