import { notFound } from "next/navigation";
import { z } from "zod";
import {
  BackLink,
  ContactButtons,
  PageHead,
  Panel,
  StayRow,
} from "@/components/admin/ui";
import { WriteToGuest } from "@/components/admin/write-to-guest";
import { messageTemplates } from "@/lib/admin/message-templates";
import { requireAdmin } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import { buildGuests } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";

const g = t.guests;

export default async function GuestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { stays } = await loadStayBook(admin);
  const guest = buildGuests(stays).find((row) => row.key === id);
  if (!guest) notFound();
  const latest = guest.stays[0];

  return (
    <div className="stack">
      <BackLink href="/admin/guests" label={g.backToList} />
      <PageHead
        title={guest.name ?? t.stay.noName}
        intro={g.stays(guest.stays.length)}
      />

      <Panel title={g.contact}>
        <ContactButtons phone={guest.phone} email={guest.email} />
        <dl className="facts">
          {guest.email && (
            <>
              <dt>{t.detail.email}</dt>
              <dd>{guest.email}</dd>
            </>
          )}
          {guest.phone && (
            <>
              <dt>{t.detail.phone}</dt>
              <dd>{guest.phone}</dd>
            </>
          )}
          {guest.country && (
            <>
              <dt>{t.detail.country}</dt>
              <dd>{guest.country}</dd>
            </>
          )}
        </dl>
      </Panel>

      <Panel title={g.history}>
        <ul className="rows">
          {guest.stays.map((stay) => (
            <StayRow key={stay.id} stay={stay} />
          ))}
        </ul>
      </Panel>

      <WriteToGuest
        target={latest.kind === "external" ? "external" : "booking"}
        id={latest.id}
        email={latest.email ?? guest.email}
        templates={messageTemplates({
          name: guest.name,
          reference: latest.reference,
          checkIn: latest.checkIn,
          checkOut: latest.checkOut,
        })}
      />
    </div>
  );
}
