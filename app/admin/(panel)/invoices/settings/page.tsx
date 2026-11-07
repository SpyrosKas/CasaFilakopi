import Link from "next/link";
import { ActionForm, Field } from "@/components/admin/form";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { saveInvoicingSettings } from "@/lib/invoicing/actions";
import { loadActiveSeries, loadInvoicingSetup } from "@/lib/invoicing/data";
import { isDummyIssuer } from "@/lib/invoicing/settings";
import { ISSUABLE_DOC_TYPES } from "@/lib/invoicing/types";

const s = t.invoices.settings;

export default async function InvoiceSettingsPage() {
  const admin = await requireOwner();
  const { settings, isStored, isUnreadable } = await loadInvoicingSetup(admin);
  const series = await loadActiveSeries(admin);
  const { issuer } = settings;

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/invoices" prefetch={false} className="text-link">
        {t.invoices.backToList}
      </Link>

      {!isStored && <p className="notice notice-info">{s.missing}</p>}
      {isUnreadable && <p className="notice notice-bad">{s.unreadable}</p>}
      {isDummyIssuer(issuer) && (
        <p className="notice notice-bad" data-testid="dummy-warning">
          {s.dummy}
        </p>
      )}
      <p className="hint">{s.issuedNote}</p>

      <ActionForm
        action={saveInvoicingSettings}
        submitLabel={t.common.save}
        pendingLabel={t.common.saving}
      >
        <Field
          label={s.legalName}
          name="legalName"
          defaultValue={issuer.legalName}
        />
        <Field
          label={s.vatNumber}
          name="vatNumber"
          defaultValue={issuer.vatNumber}
        />
        <Field
          label={s.taxOffice}
          name="taxOffice"
          defaultValue={issuer.taxOffice}
        />
        <Field label={s.address} name="address" defaultValue={issuer.address} />
        <Field
          label={s.phone}
          name="phone"
          type="tel"
          defaultValue={issuer.phone}
        />
        <Field
          label={s.email}
          name="email"
          type="email"
          defaultValue={issuer.email}
        />
        <fieldset>
          <legend>{s.defaultType}</legend>
          {ISSUABLE_DOC_TYPES.map((value) => (
            <label className="choice" key={value}>
              <input
                type="radio"
                name="defaultDocType"
                value={value}
                defaultChecked={settings.defaultDocType === value}
              />
              <span>{t.invoices.docType[value]}</span>
            </label>
          ))}
        </fieldset>
      </ActionForm>

      <section className="stack">
        <h2>{s.fixedHeading}</h2>
        <p className="hint">{s.fixedNote}</p>
        <dl className="facts">
          <dt>{s.provisional}</dt>
          <dd>{settings.isProvisional ? s.provisionalOn : s.provisionalOff}</dd>
          <dt>{s.mode}</dt>
          <dd>{s.modeOff}</dd>
          <dt>{s.series}</dt>
          {series.length === 0 && <dd>{s.noSeries}</dd>}
          {series.map((entry) => (
            <dd key={entry.docType}>
              {t.invoices.docType[entry.docType]}: {entry.prefix}
            </dd>
          ))}
        </dl>
      </section>
    </div>
  );
}
