import { formatMoment } from "@/components/admin/integrations/format";
import type { SyncLogView } from "@/lib/channels/data";
import { channelStrings as s } from "@/lib/channels/strings";

export function SyncLog({ rows }: { rows: SyncLogView[] }) {
  return (
    <section className="channel-section" data-testid="sync-log">
      <h2>{s.log.heading}</h2>
      {rows.length === 0 ? (
        <p>{s.log.empty}</p>
      ) : (
        <ul className="channel-log">
          {rows.map((row) => (
            <li key={row.id}>
              <span>
                <strong>{s.names[row.channel]}</strong>,{" "}
                {formatMoment(row.startedAt)}
              </span>
              {row.status === "failed" ? (
                <span className="channel-log-bad">
                  {s.log.failed}
                  {row.error &&
                    s.failure[row.error] &&
                    `: ${s.failure[row.error]}`}
                </span>
              ) : (
                <span>
                  {row.status === "success" ? s.log.success : s.log.running}
                  {row.eventsSeen !== null &&
                    `, ${s.log.events(row.eventsSeen)}`}
                </span>
              )}
              {row.notes.unreadable ? (
                <span className="channel-log-bad">
                  {s.log.unreadable(row.notes.unreadable)}
                </span>
              ) : null}
              {row.notes.released ? (
                <span>{s.log.released(row.notes.released)}</span>
              ) : null}
              {row.notes.echoed ? (
                <span>{s.log.echoed(row.notes.echoed)}</span>
              ) : null}
              {row.notes.alertUnsent ? (
                <span className="channel-log-bad">{s.log.alertUnsent}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
