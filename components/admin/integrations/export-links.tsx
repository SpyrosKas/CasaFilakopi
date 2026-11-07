"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/admin/form";
import { formatMoment } from "@/components/admin/integrations/format";
import { idleState } from "@/lib/admin/form-state";
import { regenerateExport, type ExportState } from "@/lib/channels/actions";
import { channelStrings as s } from "@/lib/channels/strings";

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState(s.export.copy);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLabel(s.export.copied);
    } catch {
      setLabel(s.export.copyFailed);
    }
  };

  return (
    <button
      type="button"
      className="button button-quiet"
      onClick={copy}
      aria-live="polite"
    >
      {label}
    </button>
  );
}

export function ExportLinks({
  roomId,
  createdAt,
}: {
  roomId: string;
  createdAt: string | null;
}) {
  const [state, formAction, pending] = useActionState<ExportState, FormData>(
    regenerateExport,
    idleState,
  );

  const button = (label: string) => (
    <form action={formAction}>
      <input type="hidden" name="roomId" value={roomId} />
      <button type="submit" className="button" disabled={pending}>
        {pending ? s.export.creating : label}
      </button>
    </form>
  );

  return (
    <section className="channel-section" data-testid="export-links">
      <h2>{s.export.heading}</h2>
      <p>{s.export.intro}</p>
      <FormMessage state={state} />
      {state.links && (
        <div className="stack">
          <p className="notice notice-info">{s.export.showOnce}</p>
          {state.links.map((link) => (
            <div key={link.channel}>
              <p>
                <strong>{s.export.linkFor(s.names[link.channel])}</strong>
              </p>
              <code className="channel-link">{link.url}</code>
              <CopyButton text={link.url} />
            </div>
          ))}
        </div>
      )}
      <p>
        {createdAt ? s.export.active(formatMoment(createdAt)) : s.export.none}
      </p>
      <details className="channel-help">
        <summary>{s.export.howHeading}</summary>
        <ol className="steps">
          {s.export.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      {createdAt ? (
        <details className="channel-help">
          <summary>{s.export.replaceHeading}</summary>
          <div className="stack">
            <p>{s.export.replaceWarning}</p>
            {button(s.export.replace)}
          </div>
        </details>
      ) : (
        button(s.export.create)
      )}
    </section>
  );
}
