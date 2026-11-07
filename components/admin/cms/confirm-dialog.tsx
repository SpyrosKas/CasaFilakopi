"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { useEffect, useRef, type ReactNode } from "react";

/** A native modal: the browser handles focus, Escape and the backdrop. */
export function ConfirmDialog({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  const { cms: t } = useAdminI18n();

  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="cms-dialog" onClose={onClose}>
      <div className="stack">
        <h2>{title}</h2>
        {children}
        <div className="cms-dialog-actions">
          {actions}
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
