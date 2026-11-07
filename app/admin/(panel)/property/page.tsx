import { adminI18n } from "@/lib/admin/i18n-server";
import { ActionForm, Field } from "@/components/admin/form";
import { saveProperty } from "@/lib/admin/actions/settings";
import { requireOwner } from "@/lib/admin/session";
import { loadProperty } from "@/lib/admin/settings-data";

export default async function PropertyPage() {
  const { t } = await adminI18n();

  const admin = await requireOwner();
  const property = await loadProperty(admin);
  const p = t.property;

  const links = (property?.social_links ?? {}) as Record<string, unknown>;
  const link = (key: string) =>
    typeof links[key] === "string" ? (links[key] as string) : "";

  return (
    <div className="stack">
      <h1>{p.title}</h1>
      <p>{p.intro}</p>
      <ActionForm
        action={saveProperty}
        submitLabel={t.common.save}
        pendingLabel={t.common.saving}
      >
        <Field label={p.name} name="name" defaultValue={property?.name ?? ""} />
        <Field
          label={p.legalName}
          name="legal_name"
          defaultValue={property?.legal_name ?? ""}
        />
        <Field
          label={p.address}
          name="address"
          defaultValue={property?.address ?? ""}
        />
        <Field
          label={p.phone}
          name="phone"
          type="tel"
          defaultValue={property?.phone ?? ""}
        />
        <Field
          label={p.email}
          name="email"
          type="email"
          defaultValue={property?.email ?? ""}
        />
        <Field
          label={p.registration}
          name="registration_number"
          defaultValue={property?.registration_number ?? ""}
        />
        <Field
          label={p.checkIn}
          name="check_in_time"
          type="time"
          defaultValue={(property?.check_in_time ?? "15:00").slice(0, 5)}
        />
        <Field
          label={p.checkOut}
          name="check_out_time"
          type="time"
          defaultValue={(property?.check_out_time ?? "11:00").slice(0, 5)}
        />
        <Field
          label={p.instagram}
          name="instagram"
          type="url"
          hint={p.linkHint}
          defaultValue={link("instagram")}
        />
        <Field
          label={p.facebook}
          name="facebook"
          type="url"
          hint={p.linkHint}
          defaultValue={link("facebook")}
        />
      </ActionForm>
    </div>
  );
}
