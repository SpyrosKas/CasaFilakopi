import { adminI18n } from "@/lib/admin/i18n-server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Field } from "@/components/admin/form";
import { PriceCheckForm } from "@/components/admin/price-check-form";
import { BackLink, PageHead } from "@/components/admin/ui";
import { changeDates, previewChangeDates } from "@/lib/admin/actions/bookings";
import { requireAdmin } from "@/lib/admin/session";
import { loadBooking } from "@/lib/admin/stay-data";

export default async function ChangeDatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t } = await adminI18n();
  const s = t.stayForm;

  const admin = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const booking = await loadBooking(admin, id);
  if (!booking) notFound();
  const href = `/admin/bookings/${id}`;
  if (booking.status !== "confirmed" && booking.status !== "checked_in") {
    redirect(href);
  }

  return (
    <div className="stack">
      <BackLink href={href} label={t.common.back} />
      <PageHead title={s.changeTitle} intro={s.changeIntro} />
      <PriceCheckForm
        previewAction={previewChangeDates}
        submitAction={changeDates}
        submitLabel={s.changeSubmit}
      >
        <input type="hidden" name="id" value={id} />
        <div className="field-row">
          <Field
            label={s.checkIn}
            name="checkIn"
            type="date"
            defaultValue={booking.check_in}
          />
          <Field
            label={s.checkOut}
            name="checkOut"
            type="date"
            defaultValue={booking.check_out}
          />
        </div>
      </PriceCheckForm>
    </div>
  );
}
