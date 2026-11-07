import { Field, SelectField, TextAreaField } from "@/components/admin/form";
import { PriceCheckForm } from "@/components/admin/price-check-form";
import { BackLink, PageHead } from "@/components/admin/ui";
import { createBooking, previewNewBooking } from "@/lib/admin/actions/bookings";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

const s = t.stayForm;

export default async function NewBookingPage() {
  await requireAdmin();

  return (
    <div className="stack">
      <BackLink href="/admin/bookings" label={t.detail.backToList} />
      <PageHead title={s.newTitle} intro={s.newIntro} />
      <PriceCheckForm
        previewAction={previewNewBooking}
        submitAction={createBooking}
        submitLabel={s.createSubmit}
      >
        <fieldset>
          <legend>{s.stayHeading}</legend>
          <div className="field-row">
            <Field label={s.checkIn} name="checkIn" type="date" />
            <Field label={s.checkOut} name="checkOut" type="date" />
          </div>
          <div className="field-row">
            <Field
              label={s.adults}
              name="adults"
              inputMode="numeric"
              defaultValue="2"
            />
            <Field
              label={s.children}
              name="children"
              inputMode="numeric"
              defaultValue="0"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend>{s.guestHeading}</legend>
          <Field label={s.name} name="name" autoComplete="off" />
          <Field label={s.email} name="email" type="email" autoComplete="off" />
          <Field label={s.phone} name="phone" type="tel" autoComplete="off" />
          <Field label={s.country} name="country" autoComplete="off" />
          <SelectField
            label={s.locale}
            name="locale"
            defaultValue="en"
            options={[
              { value: "en", label: s.localeEn },
              { value: "el", label: s.localeEl },
            ]}
          />
          <SelectField
            label={s.source}
            name="source"
            defaultValue="manual"
            options={[
              { value: "manual", label: s.sourceManual },
              { value: "other", label: s.sourceOther },
            ]}
          />
          <TextAreaField
            label={s.notes}
            name="notes"
            hint={s.notesHint}
            defaultValue=""
            rows={3}
          />
        </fieldset>
      </PriceCheckForm>
    </div>
  );
}
