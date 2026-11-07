import { ActionForm, Field, SelectField } from "@/components/admin/form";
import { PageHead } from "@/components/admin/ui";
import { saveBookingSettings } from "@/lib/admin/actions/settings";
import { MIN_HOLD_MINUTES } from "@/lib/admin/config";
import { requireOwner } from "@/lib/admin/session";
import { loadBookingSettings } from "@/lib/admin/settings-data";
import { t } from "@/lib/admin/strings";

/** Stored as an hour from 0 to 24, shown as a time of day. */
const CUTOFF_OPTIONS = [
  { value: "24", label: t.booking.cutoffNoLimit },
  ...Array.from({ length: 23 }, (_, index) => ({
    value: String(index + 1),
    label: t.booking.cutoffAt(index + 1),
  })),
  { value: "0", label: t.booking.cutoffNever },
];

export default async function BookingSettingsPage() {
  const admin = await requireOwner();
  const settings = await loadBookingSettings(admin);
  const b = t.booking;

  return (
    <div className="stack">
      <PageHead title={b.title} intro={b.intro} />
      <ActionForm
        action={saveBookingSettings}
        submitLabel={t.common.save}
        pendingLabel={t.common.saving}
      >
        <Field
          label={b.hold}
          name="holdMinutes"
          inputMode="numeric"
          hint={b.holdHint(MIN_HOLD_MINUTES)}
          defaultValue={settings.holdMinutes}
        />
        <SelectField
          label={b.cutoff}
          name="sameDayCutoffHour"
          hint={b.cutoffHint}
          defaultValue={String(settings.sameDayCutoffHour)}
          options={CUTOFF_OPTIONS}
        />
        <Field
          label={b.horizon}
          name="horizonMonths"
          inputMode="numeric"
          defaultValue={settings.horizonMonths}
        />
      </ActionForm>
    </div>
  );
}
