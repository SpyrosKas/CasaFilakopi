import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  BackLink,
  ContactButtons,
  PageHead,
  Panel,
  StayRow,
} from "@/components/admin/ui";
import { ActionForm, CheckField } from "@/components/admin/form";
import { WriteToGuest } from "@/components/admin/write-to-guest";
import { anonymiseGuest } from "@/lib/admin/actions/gdpr";
import { formatDate, formatStay } from "@/lib/admin/format";
import { loadGuestData } from "@/lib/admin/guest-data";
import type { GuestDataExport } from "@/lib/admin/guest-export";
import { messageTemplates } from "@/lib/admin/message-templates";
import { requireAdmin } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import { buildGuests } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";

const g = t.guests;
const p = t.ops.privacy;

/** Owner only: a copy of everything held, and the right to be removed. */
function PrivacyPanel({
  id,
  candidates,
}: {
  id: string;
  candidates: GuestDataExport["candidates"];
}) {
  const count = candidates.imported.length + candidates.messages.length;
  return (
    <Panel title={p.title}>
      <div className="stack" data-testid="guest-privacy">
        <p className="hint">{p.intro}</p>
        <p>
          <a
            href={`/admin/guests/${id}/export`}
            className="button button-quiet"
          >
            {p.exportLink}
          </a>
        </p>
        <p className="hint">{p.exportHint}</p>
        {count > 0 && (
          <div className="stack" data-testid="name-candidates">
            <h3>{p.candidatesTitle}</h3>
            <p className="hint">{p.candidatesHint}</p>
            <ul>
              {candidates.imported.map((stay) => (
                <li key={stay.id}>
                  <Link
                    href={`/admin/guests/${stay.id}`}
                    prefetch={false}
                    className="text-link"
                  >
                    {p.candidateStay(
                      formatStay(stay.start_date, stay.end_date),
                    )}
                  </Link>
                </li>
              ))}
              {candidates.messages.map((message) => (
                <li key={message.id}>
                  <Link
                    href={`/admin/messages/${message.id}`}
                    prefetch={false}
                    className="text-link"
                  >
                    {p.candidateMessage(
                      formatDate(message.created_at.slice(0, 10)),
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            <p>
              <a
                href={`/admin/guests/${id}/export?candidates=1`}
                className="button button-quiet"
              >
                {p.exportWithCandidates}
              </a>
            </p>
          </div>
        )}
        <h3>{p.anonymiseTitle}</h3>
        <p className="hint">{p.anonymiseHint}</p>
        <ActionForm
          action={anonymiseGuest}
          submitLabel={p.anonymiseSubmit}
          pendingLabel={p.anonymiseSubmitting}
          danger
        >
          <input type="hidden" name="id" value={id} />
          <CheckField label={p.anonymiseConfirm} name="understood" />
        </ActionForm>
      </div>
    </Panel>
  );
}

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

  const { data: record } = await admin.supabase
    .from("guests")
    .select("anonymized_at")
    .eq("id", id)
    .maybeSingle();
  const removedAt = record?.anonymized_at;
  const privacy =
    !removedAt && admin.role === "owner"
      ? await loadGuestData(admin, id)
      : null;

  return (
    <div className="stack">
      <BackLink href="/admin/guests" label={g.backToList} />
      <PageHead
        title={guest.name ?? t.stay.noName}
        intro={g.stays(guest.stays.length)}
      />

      {removedAt && (
        <p className="notice" role="status" data-testid="guest-anonymised">
          {p.anonymised(formatDate(removedAt.slice(0, 10)))}
        </p>
      )}

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

      {!removedAt && (
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
      )}

      {privacy && <PrivacyPanel id={id} candidates={privacy.candidates} />}
    </div>
  );
}
