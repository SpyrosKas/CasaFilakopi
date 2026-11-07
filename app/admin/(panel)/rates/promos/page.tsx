import { adminI18n } from "@/lib/admin/i18n-server";
import {
  ActionButton,
  ActionForm,
  CheckField,
  Field,
  SelectField,
} from "@/components/admin/form";
import { RatesTabs } from "@/components/admin/rates-tabs";
import { Badge, Empty, PageHead, Panel } from "@/components/admin/ui";
import { deletePromo, savePromo } from "@/lib/admin/actions/rates";
import type { AdminI18n } from "@/lib/admin/i18n";
import { requireOwner } from "@/lib/admin/session";

interface PromoValues {
  id?: string;
  code?: string;
  kind?: string;
  value?: number;
  valid_from?: string | null;
  valid_to?: string | null;
  max_uses?: number | null;
  is_active?: boolean;
}

const valueText = (
  promo: PromoValues,
  { centsToBox, formatPercent }: AdminI18n,
) =>
  promo.value === undefined
    ? ""
    : promo.kind === "percent"
      ? formatPercent(promo.value).slice(0, -1)
      : centsToBox(promo.value);

async function PromoFields({ promo }: { promo: PromoValues }) {
  const i18n = await adminI18n();
  const { t } = i18n;
  const r = t.rates;

  return (
    <>
      {promo.id && <input type="hidden" name="id" value={promo.id} />}
      <Field
        label={r.promoCode}
        name="code"
        defaultValue={promo.code ?? ""}
        autoComplete="off"
      />
      <SelectField
        label={r.promoKind}
        name="kind"
        defaultValue={promo.kind ?? "percent"}
        options={[
          { value: "percent", label: r.promoPercent },
          { value: "fixed", label: r.promoFixed },
        ]}
      />
      <Field
        label={r.promoValue}
        name="value"
        inputMode="decimal"
        defaultValue={valueText(promo, i18n)}
      />
      <div className="field-row">
        <Field
          label={r.promoFrom}
          name="validFrom"
          type="date"
          defaultValue={promo.valid_from ?? ""}
        />
        <Field
          label={r.promoTo}
          name="validTo"
          type="date"
          defaultValue={promo.valid_to ?? ""}
        />
      </div>
      <Field
        label={r.promoMax}
        name="maxUses"
        inputMode="numeric"
        defaultValue={promo.max_uses ?? ""}
      />
      <CheckField
        label={r.promoActive}
        name="isActive"
        defaultChecked={promo.is_active ?? true}
      />
    </>
  );
}

export default async function PromosPage() {
  const { t, formatEuro, formatPercent } = await adminI18n();
  const r = t.rates;

  const admin = await requireOwner();
  const { data: promos, error } = await admin.supabase
    .from("promo_codes")
    .select(
      "id, code, kind, value, valid_from, valid_to, max_uses, used_count, is_active",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (
    <div className="stack">
      <PageHead title={r.title} intro={r.promosIntro} />
      <RatesTabs current="promos" isOwner />

      {promos.length === 0 && <Empty>{r.promosEmpty}</Empty>}
      {promos.map((promo) => (
        <Panel key={promo.id} title={promo.code}>
          <p className="muted">
            {r.promoOff(
              promo.kind === "percent"
                ? formatPercent(promo.value)
                : formatEuro(promo.value),
            )}
            {", "}
            {r.promoUsed(promo.used_count)}
          </p>
          {!promo.is_active && <Badge>{r.feeOff}</Badge>}
          <details className="edit-box">
            <summary>{t.common.edit}</summary>
            <div className="card-actions">
              <ActionForm
                action={savePromo}
                submitLabel={t.common.save}
                pendingLabel={t.common.saving}
              >
                <PromoFields promo={promo} />
              </ActionForm>
              {promo.used_count === 0 && (
                <ActionButton
                  action={deletePromo}
                  fields={{ id: promo.id }}
                  label={t.common.delete}
                  pendingLabel={t.common.deleting}
                  variant="danger"
                  confirm={r.deleteConfirm}
                />
              )}
            </div>
          </details>
        </Panel>
      ))}

      <Panel title={r.promoAdd}>
        <ActionForm
          action={savePromo}
          submitLabel={r.promoAdd}
          pendingLabel={t.common.saving}
          resetOnOk
        >
          <PromoFields promo={{}} />
        </ActionForm>
      </Panel>
    </div>
  );
}
