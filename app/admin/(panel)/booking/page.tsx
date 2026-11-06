import { ActionForm, Field } from "@/components/admin/form";
import { saveBookingSettings } from "@/lib/admin/actions/settings";
import { MIN_HOLD_MINUTES } from "@/lib/admin/config";
import { requireOwner } from "@/lib/admin/session";
import { loadBookingSettings } from "@/lib/admin/settings-data";
import { t } from "@/lib/admin/strings";

export default async function BookingSettingsPage() {
  const admin = await requireOwner();
  const settings = await loadBookingSettings(admin);
  const b = t.booking;

  return (
    <div className="stack">
      <h1>{b.title}</h1>
      <p>{b.intro}</p>
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
        <Field
          label={b.cutoff}
          name="sameDayCutoffHour"
          inputMode="numeric"
          hint={b.cutoffHint}
          defaultValue={settings.sameDayCutoffHour}
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
