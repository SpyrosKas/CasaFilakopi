import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, TextAreaField } from "@/components/admin/form";
import { SentMessages } from "@/components/admin/guest-log";
import {
  BackLink,
  ContactButtons,
  PageHead,
  Panel,
  StayBadges,
} from "@/components/admin/ui";
import { WriteToGuest } from "@/components/admin/write-to-guest";
import { saveExternalDetails } from "@/lib/admin/actions/bookings";
import {
  centsToBox,
  formatDate,
  formatEuro,
  nightsWord,
} from "@/lib/admin/format";
import { messageTemplates } from "@/lib/admin/message-templates";
import { requireAdmin } from "@/lib/admin/session";
import { loadExternalEmails, loadExternalStay } from "@/lib/admin/stay-data";
import { t } from "@/lib/admin/strings";

const e = t.external;

/** An Airbnb or Booking.com stay. The calendar gives dates, he adds the rest. */
export default async function ExternalBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const stay = await loadExternalStay(admin, id);
  if (!stay) notFound();
  const emails = await loadExternalEmails(admin, id);
  const isOwner = admin.role === "owner";
  const channel = t.stay.source[stay.source];

  return (
    <div className="stack">
      <BackLink href="/admin/bookings" label={t.detail.backToList} />
      <PageHead title={stay.name ?? e.title(channel)} intro={e.intro} />
      <StayBadges stay={stay} />
      {stay.isConflicted && <p className="notice notice-bad">{e.conflict}</p>}

      <div className="columns">
        <Panel title={e.dates}>
          <dl className="facts">
            <dt>{t.detail.arrive}</dt>
            <dd>{formatDate(stay.checkIn)}</dd>
            <dt>{t.detail.leave}</dt>
            <dd>{formatDate(stay.checkOut)}</dd>
            <dt>{t.detail.nights}</dt>
            <dd>{nightsWord(stay.nights)}</dd>
            {stay.summary && (
              <>
                <dt>{e.summary}</dt>
                <dd>{stay.summary}</dd>
              </>
            )}
            {isOwner && (
              <>
                <dt>{e.amountSaved}</dt>
                <dd>
                  {stay.enteredCents === null
                    ? e.amountMissing
                    : formatEuro(stay.enteredCents)}
                </dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title={t.detail.guest}>
          <ContactButtons phone={stay.phone} email={stay.email} />
          <dl className="facts">
            {stay.email && (
              <>
                <dt>{t.detail.email}</dt>
                <dd>{stay.email}</dd>
              </>
            )}
            {stay.phone && (
              <>
                <dt>{t.detail.phone}</dt>
                <dd>{stay.phone}</dd>
              </>
            )}
          </dl>
        </Panel>
      </div>

      <Panel title={e.detailsHeading}>
        <ActionForm
          action={saveExternalDetails}
          submitLabel={e.save}
          pendingLabel={t.common.saving}
        >
          <input type="hidden" name="id" value={id} />
          <Field
            label={e.name}
            name="name"
            defaultValue={stay.name ?? ""}
            autoComplete="off"
          />
          <Field
            label={e.email}
            name="email"
            type="email"
            defaultValue={stay.email ?? ""}
            autoComplete="off"
          />
          <Field
            label={e.phone}
            name="phone"
            type="tel"
            defaultValue={stay.phone ?? ""}
            autoComplete="off"
          />
          {isOwner ? (
            <Field
              label={e.amount}
              name="amount"
              inputMode="decimal"
              hint={e.amountHint}
              defaultValue={centsToBox(stay.enteredCents)}
            />
          ) : (
            <p className="muted small">{e.amountOwnerOnly}</p>
          )}
          <TextAreaField
            label={e.notes}
            name="notes"
            defaultValue={stay.notes ?? ""}
            rows={3}
          />
        </ActionForm>
      </Panel>

      <WriteToGuest
        target="external"
        id={id}
        email={stay.email}
        templates={messageTemplates({
          name: stay.name,
          reference: null,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
        })}
      />
      <SentMessages messages={emails} />
    </div>
  );
}
