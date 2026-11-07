"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import { LineIcon } from "./line-icon";

/**
 * Native <dialog>: the browser handles the focus trap, Esc, the backdrop and
 * giving focus back to the button that opened it.
 */
export function Dialog({
  label,
  onClose,
  children,
  fullScreen = false,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  fullScreen?: boolean;
}) {
  const t = useTranslations("Common");
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const root = document.documentElement;
    if (!dialog.open) dialog.showModal();
    root.style.overflow = "hidden";
    // No dialog.close() here: its close event would unmount a dialog that
    // StrictMode is only re-running. Every way out closes it first anyway.
    return () => {
      root.style.overflow = "";
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`site-dialog${fullScreen ? " site-dialog--full" : ""}`}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog itself, not its content, is on the backdrop.
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="modal-content">
        <div className="site-dialog__bar">
          <button
            type="button"
            className="site-dialog__close"
            aria-label={t("close")}
            onClick={() => ref.current?.close()}
          >
            <LineIcon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
