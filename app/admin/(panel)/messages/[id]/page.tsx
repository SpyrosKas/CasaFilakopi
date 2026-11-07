import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionButton } from "@/components/admin/form";
import { SentMessages } from "@/components/admin/guest-log";
import {
  BackLink,
  ContactButtons,
  PageHead,
  Panel,
} from "@/components/admin/ui";
import { WriteToGuest } from "@/components/admin/write-to-guest";
import { setMessageStatus } from "@/lib/admin/actions/messages";
import { requireAdmin } from "@/lib/admin/session";
import {
  loadContactEmails,
  loadMessage,
  loadStayBook,
} from "@/lib/admin/stay-data";

export default async function MessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, formatStamp } = await adminI18n();
  const m = t.messages;

  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const message = await loadMessage(admin, id);
  if (!message) notFound();

  // Opening a message reads it. Pages here are never prefetched or cached.
  if (!message.is_read) {
    const { error } = await admin.supabase
      .from("contact_messages")
      .update({ is_read: true })
      .eq("id", id);
    if (error) throw error;
  }

  const [{ stays }, emails] = await Promise.all([
    loadStayBook(admin),
    loadContactEmails(admin, id),
  ]);
  const email = message.email.toLowerCase();
  const related = stays.filter(
    (stay) =>
      stay.id === message.booking_id || stay.email?.toLowerCase() === email,
  );

  const move = (status: string, label: string, primary = false) => (
    <ActionButton
      action={setMessageStatus}
      fields={{ id, status }}
      label={label}
      pendingLabel={t.common.saving}
      variant={primary ? "main" : "quiet"}
    />
  );

  return (
    <div className="stack">
      <BackLink href="/admin/messages" label={m.backToList} />
      <PageHead
        title={message.name}
        intro={`${m.received} ${formatStamp(message.created_at)}`}
      />

      <Panel>
        <p className="message-text">{message.message}</p>
        {message.dates_of_interest && (
          <p className="muted small">
            {m.dates}: {message.dates_of_interest}
          </p>
        )}
        <ContactButtons phone={message.phone} email={message.email} />
        <p className="muted small">
          {message.email}
          {message.phone ? `, ${message.phone}` : ""}
        </p>
      </Panel>

      <div className="button-row">
        {message.status !== "replied" && move("replied", m.markReplied, true)}
        {message.status !== "archived" && move("archived", m.archive)}
        {message.status !== "new" && move("new", m.reopen)}
      </div>

      <Panel title={m.relatedBooking}>
        {related.length === 0 ? (
          <p className="muted">{m.noBooking}</p>
        ) : (
          <ul className="rows">
            {related.map((stay) => (
              <li key={stay.id}>
                <Link href={stay.href} prefetch={false} className="row">
                  <span className="row-main">
                    <span className="row-title">
                      {stay.reference ?? t.stay.source[stay.source]}
                    </span>
                    <span className="row-sub">
                      {stay.checkIn} - {stay.checkOut}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WriteToGuest
        target="contact"
        id={id}
        email={message.email}
        locale={message.locale}
        templates={[]}
      />
      <SentMessages messages={emails} />
    </div>
  );
}
