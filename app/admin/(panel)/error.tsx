"use client";

import { useAdminI18n } from "@/components/admin/language-provider";

export default function PanelError({ reset }: { reset: () => void }) {
  const { t } = useAdminI18n();

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
