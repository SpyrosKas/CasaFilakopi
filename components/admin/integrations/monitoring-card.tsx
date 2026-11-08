"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { ActionForm } from "@/components/admin/form";
import { sendTestAlert } from "@/lib/channels/actions";

/** Whether errors reach Sentry, and a button to prove it. */
export function MonitoringCard({ enabled }: { enabled: boolean }) {
  const { channels: s } = useAdminI18n();
  return (
    <section className="stack" aria-labelledby="monitoring-heading">
      <h2 id="monitoring-heading">{s.monitoring.heading}</h2>
      <p>{enabled ? s.monitoring.on : s.monitoring.off}</p>
      {enabled && (
        <ActionForm
          action={sendTestAlert}
          submitLabel={s.monitoring.test}
          pendingLabel={s.monitoring.sending}
        >
          {null}
        </ActionForm>
      )}
    </section>
  );
}
