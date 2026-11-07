import Link from "next/link";
import { Badge, Panel } from "@/components/admin/ui";
import { formatStamp } from "@/lib/admin/format";
import type { SentMessage } from "@/lib/admin/stay-data";
import { t } from "@/lib/admin/strings";

const w = t.write;

function SentState({ status }: { status: string }) {
  if (status === "queued" || status === "sending") {
    return <Badge tone="warn">{w.pending}</Badge>;
  }
  if (status === "failed" || status === "bounced") {
    return <Badge tone="bad">{w.failed}</Badge>;
  }
  return <Badge tone="ok">{w.sent}</Badge>;
}

/** What was written to this guest, and whether it has gone yet. */
export function SentMessages({ messages }: { messages: SentMessage[] }) {
  return (
    <Panel title={w.logTitle}>
      {messages.length === 0 ? (
        <p className="muted">{w.logEmpty}</p>
      ) : (
        <ul className="timeline">
          {messages.map((message) => (
            <li key={message.id} data-testid="sent-message">
              <span className="row-title">{message.subject}</span>
              <span className="row-sub">
                {formatStamp(message.createdAt)}, {message.recipient}
              </span>
              <span className="row-badges">
                <SentState status={message.status} />
              </span>
              <p className="message-text small">{message.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function GuestMessages({
  messages,
}: {
  messages: { id: string; message: string; created_at: string }[];
}) {
  return (
    <Panel title={t.detail.messages}>
      {messages.length === 0 ? (
        <p className="muted">{t.detail.messagesEmpty}</p>
      ) : (
        <ul className="rows">
          {messages.map((row) => (
            <li key={row.id}>
              <Link
                href={`/admin/messages/${row.id}`}
                prefetch={false}
                className="row"
              >
                <span className="row-main">
                  <span className="row-sub">{formatStamp(row.created_at)}</span>
                  <span>{row.message.slice(0, 120)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
