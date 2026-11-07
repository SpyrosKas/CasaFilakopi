import {
  ActionButton,
  ActionForm,
  CheckField,
  Field,
  SelectField,
} from "@/components/admin/form";
import { RatesTabs } from "@/components/admin/rates-tabs";
import { Badge, Empty, PageHead, Panel } from "@/components/admin/ui";
import { deleteFee, saveFee } from "@/lib/admin/actions/rates";
import { centsToBox, formatEuro } from "@/lib/admin/format";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

const r = t.rates;

const KIND_OPTIONS = Object.entries(r.feeKinds).map(([value, label]) => ({
  value,
  label,
}));

interface FeeValues {
  id?: string;
  name?: unknown;
  kind?: string;
  amount_cents?: number | null;
  rate_basis_points?: number | null;
  is_vat?: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
}

const nameIn = (fee: FeeValues, locale: "en" | "el") =>
  (fee.name as Record<string, string> | undefined)?.[locale] ?? "";

const percentText = (points: number | null | undefined) =>
  points === null || points === undefined ? "" : String(points / 100);

function FeeFields({ fee }: { fee: FeeValues }) {
  return (
    <>
      {fee.id && <input type="hidden" name="id" value={fee.id} />}
      <Field
        label={r.feeNameEn}
        name="nameEn"
        defaultValue={nameIn(fee, "en")}
      />
      <Field
        label={r.feeNameEl}
        name="nameEl"
        defaultValue={nameIn(fee, "el")}
      />
      <SelectField
        label={r.feeKind}
        name="kind"
        defaultValue={fee.kind ?? "per_night"}
        options={KIND_OPTIONS}
      />
      <div className="field-row">
        <Field
          label={r.feeAmount}
          name="amount"
          inputMode="decimal"
          defaultValue={centsToBox(fee.amount_cents)}
        />
        <Field
          label={r.feePercent}
          name="percent"
          inputMode="decimal"
          defaultValue={percentText(fee.rate_basis_points)}
        />
      </div>
      <div className="field-row">
        <Field
          label={r.feeFrom}
          name="validFrom"
          type="date"
          defaultValue={fee.valid_from ?? ""}
        />
        <Field
          label={r.feeTo}
          name="validTo"
          type="date"
          defaultValue={fee.valid_to ?? ""}
        />
      </div>
      <CheckField label={r.feeIsVat} name="isVat" defaultChecked={fee.is_vat} />
      <CheckField
        label={r.feeActive}
        name="isActive"
        defaultChecked={fee.is_active ?? true}
      />
    </>
  );
}

export default async function FeesPage() {
  const admin = await requireOwner();
  const { data: fees, error } = await admin.supabase
    .from("taxes_fees")
    .select(
      "id, name, kind, amount_cents, rate_basis_points, is_vat, valid_from, valid_to, is_active, sort_order",
    )
    .order("sort_order");
  if (error) throw error;

  return (
    <div className="stack">
      <PageHead title={r.title} intro={r.feesIntro} />
      <RatesTabs current="fees" isOwner />

      {fees.length === 0 && <Empty>{r.feesEmpty}</Empty>}
      {fees.map((fee) => (
        <Panel key={fee.id} title={nameIn(fee, "en")}>
          <p className="muted">
            {r.feeKinds[fee.kind]}:{" "}
            {fee.kind === "percent"
              ? `${percentText(fee.rate_basis_points)}%`
              : formatEuro(fee.amount_cents ?? 0)}
          </p>
          {!fee.is_active && <Badge>{r.feeOff}</Badge>}
          <details className="edit-box">
            <summary>{t.common.edit}</summary>
            <div className="card-actions">
              <ActionForm
                action={saveFee}
                submitLabel={t.common.save}
                pendingLabel={t.common.saving}
              >
                <FeeFields fee={fee} />
              </ActionForm>
              <ActionButton
                action={deleteFee}
                fields={{ id: fee.id }}
                label={t.common.delete}
                pendingLabel={t.common.deleting}
                variant="danger"
                confirm={r.deleteConfirm}
              />
            </div>
          </details>
        </Panel>
      ))}

      <Panel title={r.feeAdd}>
        <ActionForm
          action={saveFee}
          submitLabel={r.feeAdd}
          pendingLabel={t.common.saving}
          resetOnOk
        >
          <FeeFields fee={{}} />
        </ActionForm>
      </Panel>
    </div>
  );
}
