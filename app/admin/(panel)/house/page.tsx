import { adminI18n } from "@/lib/admin/i18n-server";
import { ActionForm, Field, TextAreaField } from "@/components/admin/form";
import { saveHouse } from "@/lib/admin/actions/settings";
import { requireOwner } from "@/lib/admin/session";
import { loadHouse } from "@/lib/admin/settings-data";

export default async function HousePage() {
  const { t } = await adminI18n();

  const admin = await requireOwner();
  const house = await loadHouse(admin);
  const h = t.house;

  if (!house) {
    return (
      <div className="stack">
        <h1>{h.title}</h1>
        <p className="notice notice-info">{h.missing}</p>
      </div>
    );
  }

  const name = house.name as Record<string, string>;
  const description = house.description as Record<string, string>;

  return (
    <div className="stack">
      <h1>{h.title}</h1>
      <p>{h.intro}</p>
      <ActionForm
        action={saveHouse}
        submitLabel={t.common.save}
        pendingLabel={t.common.saving}
      >
        <Field label={h.nameEn} name="name_en" defaultValue={name.en ?? ""} />
        <Field label={h.nameEl} name="name_el" defaultValue={name.el ?? ""} />
        <TextAreaField
          label={h.descriptionEn}
          name="description_en"
          defaultValue={description.en ?? ""}
        />
        <TextAreaField
          label={h.descriptionEl}
          name="description_el"
          defaultValue={description.el ?? ""}
        />
        <Field
          label={h.maxAdults}
          name="max_adults"
          inputMode="numeric"
          defaultValue={house.max_adults}
        />
        <Field
          label={h.maxChildren}
          name="max_children"
          inputMode="numeric"
          defaultValue={house.max_children}
        />
        <Field
          label={h.baseGuests}
          name="base_occupancy"
          inputMode="numeric"
          defaultValue={house.base_occupancy}
        />
      </ActionForm>
      <p className="hint">{h.photosLater}</p>
    </div>
  );
}
