import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
  TextAreaField,
} from "@/components/admin/form";
import { GuestMessages, SentMessages } from "@/components/admin/guest-log";
import {
  BackLink,
  ContactButtons,
  MoneyLines,
  PageHead,
  Panel,
  stayName,
  StayBadges,
} from "@/components/admin/ui";
import { WriteToGuest } from "@/components/admin/write-to-guest";
import {
  markStay,
  recordPayment,
  recordRefund,
  saveNotes,
} from "@/lib/admin/actions/bookings";
import {
  formatDate,
  formatEuro,
  formatStamp,
  nightsWord,
} from "@/lib/admin/format";
import { messageTemplates } from "@/lib/admin/message-templates";
import { requireAdmin } from "@/lib/admin/session";
import {
  loadBooking,
  loadBookingEmails,
  loadBookingMoney,
  loadHistory,
  loadMessagesForBooking,
  type HistoryEntry,
} from "@/lib/admin/stay-data";
import {
  holdsMoneyUnconfirmed,
  refundableOf,
  stayFromBooking,
} from "@/lib/admin/stays";
import { ADMIN_LANGUAGE, t } from "@/lib/admin/strings";
import type { PriceBreakdown } from "@/lib/domain/contracts";
import { athensDate } from "@/lib/domain/dates";

const d = t.detail;
const a = t.act;

const manualMethods = (["cash", "bank_transfer", "pos"] as const).map(
  (value) => ({ value, label: t.stay.method[value] }),
);

function priceLines(breakdown: unknown, total: number) {
  const lines = (breakdown as Partial<PriceBreakdown> | null)?.lines ?? [];
  return [
    ...lines.map((line) => ({
      label:
        line.kind === "accommodation"
          ? d.lineNights(line.quantity, formatEuro(line.unitCents))
          : (line.label[ADMIN_LANGUAGE] ?? ""),
      value: formatEuro(line.totalCents),
    })),
    { label: d.priceTotal, value: formatEuro(total), strong: true },
  ];
}

const historyLabel = (entry: HistoryEntry): string => {
  const amount =
    typeof entry.after?.amount_cents === "number"
      ? formatEuro(entry.after.amount_cents)
      : "";
  if (entry.entity === "payments") return d.historyEvents.paid(amount);
  if (entry.entity === "refunds") return d.historyEvents.refund(amount);
  if (entry.action === "insert") return d.historyEvents.created;
  return d.historyEvents.update;
};

export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const booking = await loadBooking(admin, id);
  if (!booking) notFound();
  const href = `/admin/bookings/${id}`;

  const [{ payments, refunds }, emails, messages] = await Promise.all([
    loadBookingMoney(admin, id),
    loadBookingEmails(admin, id),
    loadMessagesForBooking(admin, id, booking.guest_email),
  ]);
  const history = await loadHistory(admin, id, [
    ...payments.map((row) => row.id),
    ...refunds.map((row) => row.id),
  ]);

  const stay = stayFromBooking(booking, payments, refunds);
  const today = athensDate(new Date());
  const isOpen =
    booking.status === "confirmed" || booking.status === "checked_in";
  const hasArrivedDate = booking.check_in <= today;
  const giveBack = stay.toRefundCents;

  const refundable = payments.flatMap((row) => {
    const left = refundableOf(row, refunds);
    return row.status === "succeeded" && row.method !== "card" && left > 0
      ? [
          {
            value: row.id,
            label: a.refundOption(t.stay.method[row.method], formatEuro(left)),
          },
        ]
      : [];
  });
  const hasCardMoney = payments.some(
    (row) => row.status === "succeeded" && row.method === "card",
  );
  const takesPayment = stay.balanceCents > 0;

  return (
    <div className="stack">
      <BackLink href="/admin/bookings" label={d.backToList} />
      <PageHead
        title={stayName(stay)}
        intro={
          booking.reference ? d.reference(booking.reference) : d.noReference
        }
      />
      <StayBadges stay={stay} />

      {holdsMoneyUnconfirmed(stay) && (
        <p className="notice notice-bad">{d.moneyHeld}</p>
      )}

      {stay.money.disputedCents > 0 && (
        <p className="notice notice-bad">{d.disputed}</p>
      )}

      <div className="columns">
        <div className="stack">
          <Panel title={d.guest}>
            <ContactButtons
              phone={booking.guest_phone}
              email={booking.guest_email}
            />
            <dl className="facts">
              {booking.guest_email && (
                <>
                  <dt>{d.email}</dt>
                  <dd>{booking.guest_email}</dd>
                </>
              )}
              {booking.guest_phone && (
                <>
                  <dt>{d.phone}</dt>
                  <dd>{booking.guest_phone}</dd>
                </>
              )}
              {booking.guest_country && (
                <>
                  <dt>{d.country}</dt>
                  <dd>{booking.guest_country}</dd>
                </>
              )}
            </dl>
            <Link href={`/admin/guests/${booking.guest_id}`} prefetch={false}>
              {d.guestPage}
            </Link>
          </Panel>

          <Panel title={d.stay}>
            <dl className="facts">
              <dt>{d.arrive}</dt>
              <dd>{formatDate(booking.check_in)}</dd>
              <dt>{d.leave}</dt>
              <dd>{formatDate(booking.check_out)}</dd>
              <dt>{d.nights}</dt>
              <dd>{nightsWord(stay.nights)}</dd>
              <dt>{d.guests}</dt>
              <dd>{d.guestsCount(booking.adults, booking.children)}</dd>
              {booking.arrival_time && (
                <>
                  <dt>{d.arrivalTime}</dt>
                  <dd>{booking.arrival_time}</dd>
                </>
              )}
              {booking.special_requests && (
                <>
                  <dt>{d.requests}</dt>
                  <dd className="message-text">{booking.special_requests}</dd>
                </>
              )}
              {booking.cancellation_reason && (
                <>
                  <dt>{d.cancelReason}</dt>
                  <dd>{booking.cancellation_reason}</dd>
                </>
              )}
            </dl>
          </Panel>

          {isOpen && (
            <Panel title={a.heading}>
              <div className="card-actions">
                {booking.status === "confirmed" && hasArrivedDate && (
                  <ActionButton
                    action={markStay}
                    fields={{ id, to: "checked_in" }}
                    label={a.markArrived}
                    pendingLabel={t.common.saving}
                  />
                )}
                {booking.status === "checked_in" && (
                  <ActionButton
                    action={markStay}
                    fields={{ id, to: "completed" }}
                    label={a.markLeft}
                    pendingLabel={t.common.saving}
                  />
                )}
                <Link
                  href={`${href}/change`}
                  prefetch={false}
                  className="button button-quiet"
                >
                  {a.changeDates}
                </Link>
                {booking.status === "confirmed" && hasArrivedDate && (
                  <ActionButton
                    action={markStay}
                    fields={{ id, to: "no_show" }}
                    label={a.markNoShow}
                    pendingLabel={t.common.saving}
                    variant="quiet"
                    confirm={a.noShowConfirm}
                  />
                )}
                <Link
                  href={`${href}/cancel`}
                  prefetch={false}
                  className="button button-danger"
                >
                  {a.cancel}
                </Link>
              </div>
            </Panel>
          )}

          <Panel title={d.notes}>
            <ActionForm
              action={saveNotes}
              submitLabel={d.notesSave}
              pendingLabel={t.common.saving}
            >
              <input type="hidden" name="id" value={id} />
              <TextAreaField
                label={d.notes}
                name="notes"
                hint={d.notesHint}
                defaultValue={booking.internal_notes ?? ""}
                rows={3}
              />
            </ActionForm>
          </Panel>
        </div>

        <div className="stack">
          <Panel title={d.price}>
            <MoneyLines
              lines={priceLines(booking.price_breakdown, booking.total_cents)}
            />
          </Panel>

          <Panel title={d.payments}>
            {payments.length === 0 ? (
              <p className="muted">{d.paymentsEmpty}</p>
            ) : (
              <ul className="rows">
                {payments.map((row) => (
                  <li key={row.id} className="money-line">
                    <span>
                      {t.stay.kind[row.kind]}, {t.stay.method[row.method]}
                      <span className="money-note">
                        {formatStamp(row.paid_at ?? row.created_at)},{" "}
                        {t.stay.paymentStatus[row.status]}
                        {row.note ? `, ${row.note}` : ""}
                      </span>
                    </span>
                    <span>{formatEuro(row.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {refunds.length > 0 && (
              <>
                <h3>{d.refunds}</h3>
                <ul className="rows">
                  {refunds.map((row) => (
                    <li key={row.id} className="money-line">
                      <span>
                        {t.stay.refundStatus[row.status]}
                        <span className="money-note">
                          {formatStamp(row.created_at)}
                          {row.reason ? `, ${row.reason}` : ""}
                        </span>
                      </span>
                      <span>{formatEuro(row.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <MoneyLines
              lines={[
                {
                  label: d.received,
                  value: formatEuro(stay.money.receivedCents),
                },
                {
                  label: d.refunded,
                  value: formatEuro(stay.money.refundedCents),
                },
                {
                  label: d.paid,
                  value: formatEuro(stay.money.paidCents),
                  strong: true,
                },
                ...(stay.balanceCents > 0
                  ? [
                      {
                        label: d.stillToPay,
                        value: formatEuro(stay.balanceCents),
                      },
                    ]
                  : []),
                ...(giveBack > 0
                  ? [{ label: d.toGiveBack, value: formatEuro(giveBack) }]
                  : []),
              ]}
            />
          </Panel>

          {takesPayment && (
            <Panel title={a.recordPayment}>
              {stay.balanceCents > 0 && (
                <p className="muted small">
                  {a.paymentHint(formatEuro(stay.balanceCents))}
                </p>
              )}
              <ActionForm
                action={recordPayment}
                submitLabel={a.recordPayment}
                pendingLabel={t.common.saving}
                resetOnOk
              >
                <input type="hidden" name="id" value={id} />
                <input
                  type="hidden"
                  name="expectedReceived"
                  value={stay.money.receivedCents}
                />
                <Field label={a.amount} name="amount" inputMode="decimal" />
                <SelectField
                  label={a.method}
                  name="method"
                  defaultValue="cash"
                  options={manualMethods}
                />
                <Field label={a.noteOptional} name="note" />
              </ActionForm>
            </Panel>
          )}

          {refundable.length > 0 && (
            <Panel title={a.recordRefund}>
              <details className="edit-box" open={giveBack > 0}>
                <summary>{a.recordRefundOpen}</summary>
                <p className="muted small">{a.refundIntro}</p>
                <ActionForm
                  action={recordRefund}
                  submitLabel={a.recordRefund}
                  pendingLabel={t.common.saving}
                  resetOnOk
                >
                  <input type="hidden" name="id" value={id} />
                  <input
                    type="hidden"
                    name="expectedRefunded"
                    value={stay.money.refundedCents}
                  />
                  <SelectField
                    label={a.refundPayment}
                    name="paymentId"
                    options={refundable}
                  />
                  <Field label={a.amount} name="amount" inputMode="decimal" />
                  <Field label={a.refundReason} name="reason" />
                </ActionForm>
              </details>
            </Panel>
          )}

          {hasCardMoney && (
            // PAY track: card refunds go reserve_refund, Stripe, settle_refund.
            <p className="notice notice-info">{a.cardRefundLater}</p>
          )}

          {admin.role === "owner" && (
            <Panel title={d.documents}>
              <Link href="/admin/invoices" prefetch={false}>
                {d.documentsLink}
              </Link>
            </Panel>
          )}
        </div>
      </div>

      <WriteToGuest
        target="booking"
        id={id}
        email={booking.guest_email}
        templates={messageTemplates({
          name: booking.guest_name,
          reference: booking.reference,
          checkIn: booking.check_in,
          checkOut: booking.check_out,
        })}
      />
      <SentMessages messages={emails} />
      <GuestMessages messages={messages} />

      <Panel title={d.history}>
        <ul className="timeline">
          {history.length > 0
            ? history.map((entry) => (
                <li key={entry.id}>
                  <span>{historyLabel(entry)}</span>
                  <span className="row-sub">
                    {formatStamp(entry.at)}
                    {entry.actor ? `, ${d.by(entry.actor)}` : ""}
                  </span>
                </li>
              ))
            : [
                booking.cancelled_at && {
                  key: "cancelled",
                  label: d.historyEvents.cancelled,
                  at: booking.cancelled_at,
                },
                booking.confirmed_at && {
                  key: "confirmed",
                  label: d.historyEvents.confirmed,
                  at: booking.confirmed_at,
                },
                {
                  key: "created",
                  label: d.historyEvents.created,
                  at: booking.created_at,
                },
              ].flatMap((entry) =>
                entry ? (
                  <li key={entry.key}>
                    <span>{entry.label}</span>
                    <span className="row-sub">{formatStamp(entry.at)}</span>
                  </li>
                ) : (
                  []
                ),
              )}
        </ul>
      </Panel>
    </div>
  );
}
