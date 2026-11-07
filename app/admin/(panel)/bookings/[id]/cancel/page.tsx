import { adminI18n } from "@/lib/admin/i18n-server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ActionForm, CheckField, Field } from "@/components/admin/form";
import { BackLink, MoneyLines, PageHead, Panel } from "@/components/admin/ui";
import { cancelBooking } from "@/lib/admin/actions/bookings";
import { requireAdmin } from "@/lib/admin/session";
import { loadBooking, loadBookingMoney } from "@/lib/admin/stay-data";
import {
  cancellationOutcome,
  planRefund,
  snapshotRules,
  summariseMoney,
} from "@/lib/admin/stays";
import { athensDate, daysBetween } from "@/lib/domain/dates";
import { sumCents } from "@/lib/domain/money";
import { readStripeSettings } from "@/lib/payments/env";

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, formatEuro } = await adminI18n();
  const c = t.cancel;

  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const booking = await loadBooking(admin, id);
  if (!booking) notFound();
  const href = `/admin/bookings/${id}`;
  if (booking.status !== "confirmed" && booking.status !== "checked_in") {
    redirect(href);
  }

  const { payments, refunds } = await loadBookingMoney(admin, id);
  const money = summariseMoney(payments, refunds);
  const today = athensDate(new Date());
  const rules = snapshotRules(booking.rules_snapshot);
  const outcome = cancellationOutcome({
    snapshot: booking.rules_snapshot,
    checkIn: booking.check_in,
    cancelledOn: today,
    totalCents: booking.total_cents,
    paidCents: money.paidCents,
  });

  if (!rules || !outcome) {
    return (
      <div className="stack">
        <BackLink href={href} label={t.common.back} />
        <PageHead title={c.title} />
        <p className="notice notice-bad">{t.detail.unreadableRules}</p>
      </div>
    );
  }

  const plan = planRefund(outcome.refundCents, payments, refunds);
  const manualCents = sumCents(plan.manual.map((row) => row.amountCents));
  const cardConnected = readStripeSettings() !== null;

  return (
    <div className="stack">
      <BackLink href={href} label={c.keepIt} />
      <PageHead title={c.title} intro={c.intro} />

      <Panel title={c.rulesTitle}>
        {rules.isNonRefundable ? (
          <p>{c.nonRefundable}</p>
        ) : (
          <ul className="preview-list">
            {rules.tiers.map((tier) => (
              <li key={tier.daysBefore}>
                {c.tier(tier.daysBefore, tier.refundPercent)}
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          {c.today(daysBetween(today, booking.check_in))}{" "}
          {outcome.appliedTier
            ? c.applied(outcome.appliedTier.refundPercent)
            : c.noneApplies}
        </p>
      </Panel>

      <Panel>
        <MoneyLines
          lines={[
            { label: c.bookingPrice, value: formatEuro(booking.total_cents) },
            { label: c.paid, value: formatEuro(money.paidCents) },
            {
              label: c.refund,
              value: formatEuro(outcome.refundCents),
              strong: true,
            },
            { label: c.keep, value: formatEuro(outcome.retainedCents) },
          ]}
        />
      </Panel>

      {/* D24: what was paid is kept and any shortfall is not chased. */}
      {outcome.refundCents === 0 && (
        <p className="notice notice-info">{c.nothingMore}</p>
      )}

      {plan.cardCents > 0 && !cardConnected && (
        <p className="notice notice-info">
          {c.cardPart(formatEuro(plan.cardCents))}
        </p>
      )}

      <ActionForm
        action={cancelBooking}
        submitLabel={c.confirm}
        pendingLabel={t.common.saving}
        danger
      >
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="expectedRefund"
          value={outcome.refundCents}
        />
        <Field label={c.reason} name="reason" />
        {manualCents > 0 && (
          <CheckField
            label={c.gaveBack(formatEuro(manualCents))}
            name="gaveBack"
            hint={c.gaveBackHint}
          />
        )}
        {plan.cardCents > 0 && cardConnected && admin.role === "owner" && (
          <CheckField
            label={c.cardRefundNow(formatEuro(plan.cardCents))}
            name="refundCard"
            hint={c.cardRefundNowHint}
            defaultChecked
          />
        )}
      </ActionForm>
    </div>
  );
}
