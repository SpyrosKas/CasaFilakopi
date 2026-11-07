import Link from "next/link";
import { ActionForm, Field } from "@/components/admin/form";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { saveEmailSettings } from "@/lib/email/admin-actions";
import { loadEmailSettings } from "@/lib/email/settings";

const s = t.email.settings;

export default async function EmailSettingsPage() {
  const admin = await requireOwner();
  const settings = await loadEmailSettings(admin.supabase);

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/email" prefetch={false} className="text-link">
        {s.back}
      </Link>

      <ActionForm
        action={saveEmailSettings}
        submitLabel={t.common.save}
        pendingLabel={t.common.saving}
      >
        <Field
          label={s.senderName}
          name="senderName"
          defaultValue={settings.senderName}
        />
        <Field
          label={s.fromAddress}
          name="fromAddress"
          type="email"
          hint={s.fromHint}
          defaultValue={settings.fromAddress}
        />
        <Field
          label={s.replyTo}
          name="replyTo"
          type="email"
          defaultValue={settings.replyTo}
        />
        <div className="field">
          <label htmlFor="field-hostRecipients">{s.hostRecipients}</label>
          <p className="hint">{s.hostHint}</p>
          <textarea
            id="field-hostRecipients"
            name="hostRecipients"
            rows={3}
            defaultValue={settings.hostRecipients.join("\n")}
          />
        </div>
        <div className="field">
          <label htmlFor="field-hostLocale">{s.hostLocale}</label>
          <select
            id="field-hostLocale"
            name="hostLocale"
            defaultValue={settings.hostLocale}
          >
            <option value="el">{s.greek}</option>
            <option value="en">{s.english}</option>
          </select>
        </div>

        <h2>{s.timing}</h2>
        <Field
          label={s.balanceReminderDays}
          name="balanceReminderDays"
          inputMode="numeric"
          hint={s.balanceHint}
          defaultValue={settings.balanceReminderDays}
        />
        <Field
          label={s.preArrivalDays}
          name="preArrivalDays"
          inputMode="numeric"
          defaultValue={settings.preArrivalDays}
        />
        <Field
          label={s.sendHour}
          name="sendHour"
          inputMode="numeric"
          defaultValue={settings.sendHour}
        />
        <label className="choice">
          <input
            type="checkbox"
            name="calendarAttachment"
            defaultChecked={settings.calendarAttachment}
          />
          <span>{s.calendarAttachment}</span>
        </label>
        <label className="choice">
          <input
            type="checkbox"
            name="thankYouEnabled"
            defaultChecked={settings.thankYouEnabled}
          />
          <span>{s.thankYouEnabled}</span>
        </label>
        <Field
          label={s.thankYouDays}
          name="thankYouDays"
          inputMode="numeric"
          defaultValue={settings.thankYouDays}
        />
      </ActionForm>
      <p className="notice notice-info">{s.invoiceLocked}</p>
    </div>
  );
}
