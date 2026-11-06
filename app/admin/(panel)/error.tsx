"use client";

import { t } from "@/lib/admin/strings";

export default function PanelError({ reset }: { reset: () => void }) {
  return (
    <div className="stack">
      <h1>{t.common.errorTitle}</h1>
      <p>{t.common.somethingWrong}</p>
      <button type="button" className="button" onClick={reset}>
        {t.common.tryAgain}
      </button>
    </div>
  );
}
