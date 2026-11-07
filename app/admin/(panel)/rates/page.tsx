import {
  RatesCalendar,
  RatesMonthNav,
  type PriceDay,
} from "@/components/admin/calendars";
import { ActionForm, CheckField, Field } from "@/components/admin/form";
import { RatesTabs } from "@/components/admin/rates-tabs";
import { PageHead, Panel } from "@/components/admin/ui";
import { saveBasePrices } from "@/lib/admin/actions/rates";
import { isMonthKey, monthDates } from "@/lib/admin/calendar";
import { centsToBox } from "@/lib/admin/format";
import { requireOwner } from "@/lib/admin/session";
import { loadBookingSettings } from "@/lib/admin/settings-data";
import { t } from "@/lib/admin/strings";
import { addDays, athensDate } from "@/lib/domain/dates";
import { nightlyPrices } from "@/lib/domain/pricing";
import { parseBookingSettings } from "@/lib/domain/settings";

const r = t.rates;

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const admin = await requireOwner();
  const today = athensDate(new Date());
  const asked = (await searchParams).month;
  const month = isMonthKey(asked) ? asked : today.slice(0, 7);

  const { data: room, error: roomError } = await admin.supabase
    .from("rooms")
    .select(
      "id, base_price_cents, base_occupancy, extra_guest_fee_cents, cleaning_fee_cents",
    )
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (roomError) throw roomError;

  if (!room) {
    return (
      <div className="stack">
        <PageHead title={r.title} />
        <p className="notice notice-info">{r.missing}</p>
      </div>
    );
  }

  const dates = monthDates(month);
  const [seasons, overrides, settings] = await Promise.all([
    admin.supabase
      .from("seasons")
      .select("start_date, end_date, nightly_cents, weekend_cents")
      .eq("room_id", room.id),
    admin.supabase
      .from("rate_overrides")
      .select("night, nightly_cents")
      .eq("room_id", room.id)
      .gte("night", dates[0])
      .lte("night", dates[dates.length - 1]),
    loadBookingSettings(admin),
  ]);
  if (seasons.error) throw seasons.error;
  if (overrides.error) throw overrides.error;

  const set = new Set(overrides.data.map((row) => row.night));
  // lib/domain sets the price of a night, so this calendar always agrees with
  // what a guest would be charged.
  const days: PriceDay[] = nightlyPrices({
    stay: {
      roomId: room.id,
      checkIn: dates[0],
      checkOut: addDays(dates[dates.length - 1], 1),
      adults: 1,
      children: 0,
    },
    room,
    seasons: seasons.data,
    overrides: overrides.data,
    weekendDays: parseBookingSettings(settings).weekendDays,
  }).map(({ night, cents }) => ({
    date: night,
    cents,
    isOverride: set.has(night),
  }));

  return (
    <div className="stack">
      <PageHead title={r.title} intro={r.intro} />
      <RatesTabs current="calendar" isOwner />

      <RatesMonthNav month={month} />

      <RatesCalendar key={month} month={month} days={days} today={today} />

      <Panel title={r.baseHeading}>
        <ActionForm
          action={saveBasePrices}
          submitLabel={t.common.save}
          pendingLabel={t.common.saving}
        >
          <Field
            label={r.base}
            name="base"
            inputMode="decimal"
            defaultValue={centsToBox(room.base_price_cents)}
          />
          <Field
            label={r.cleaning}
            name="cleaning"
            inputMode="decimal"
            defaultValue={centsToBox(room.cleaning_fee_cents)}
          />
          <Field
            label={r.extraGuest}
            name="extraGuest"
            inputMode="decimal"
            hint={r.extraGuestHint(room.base_occupancy)}
            defaultValue={centsToBox(room.extra_guest_fee_cents)}
          />
          <CheckField label={r.confirmFree} name="confirmFree" />
        </ActionForm>
      </Panel>
    </div>
  );
}
