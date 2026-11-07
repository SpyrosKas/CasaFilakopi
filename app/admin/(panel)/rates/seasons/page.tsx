import { adminI18n } from "@/lib/admin/i18n-server";
import { ActionButton, ActionForm, Field } from "@/components/admin/form";
import { RatesTabs } from "@/components/admin/rates-tabs";
import { Empty, PageHead, Panel } from "@/components/admin/ui";
import { deleteSeason, saveSeason } from "@/lib/admin/actions/rates";
import { requireOwner } from "@/lib/admin/session";

interface SeasonValues {
  id?: string;
  name?: string;
  start_date?: string;
  end_date?: string;
  nightly_cents?: number;
  weekend_cents?: number | null;
}

async function SeasonFields({ season }: { season: SeasonValues }) {
  const { t, centsToBox } = await adminI18n();
  const r = t.rates;

  return (
    <>
      {season.id && <input type="hidden" name="id" value={season.id} />}
      <Field
        label={r.seasonName}
        name="name"
        defaultValue={season.name ?? ""}
      />
      <div className="field-row">
        <Field
          label={r.seasonStart}
          name="from"
          type="date"
          defaultValue={season.start_date ?? ""}
        />
        <Field
          label={r.seasonEnd}
          name="to"
          type="date"
          defaultValue={season.end_date ?? ""}
        />
      </div>
      <Field
        label={r.seasonNight}
        name="night"
        inputMode="decimal"
        defaultValue={centsToBox(season.nightly_cents)}
      />
      <Field
        label={r.seasonWeekend}
        name="weekend"
        inputMode="decimal"
        defaultValue={centsToBox(season.weekend_cents)}
      />
    </>
  );
}

export default async function SeasonsPage() {
  const { t, formatDate, formatEuro } = await adminI18n();
  const r = t.rates;

  const admin = await requireOwner();
  const { data: seasons, error } = await admin.supabase
    .from("seasons")
    .select("id, name, start_date, end_date, nightly_cents, weekend_cents")
    .order("start_date");
  if (error) throw error;

  return (
    <div className="stack">
      <PageHead title={r.title} intro={r.seasonsIntro} />
      <RatesTabs current="seasons" isOwner />

      {seasons.length === 0 && <Empty>{r.seasonsEmpty}</Empty>}
      {seasons.map((season) => (
        <Panel key={season.id} title={season.name}>
          <p>
            {r.dateRange(
              formatDate(season.start_date),
              formatDate(season.end_date),
            )}
          </p>
          <p className="muted">
            {r.seasonLine(
              formatEuro(season.nightly_cents),
              season.weekend_cents === null
                ? null
                : formatEuro(season.weekend_cents),
            )}
          </p>
          <details className="edit-box">
            <summary>{t.common.edit}</summary>
            <div className="card-actions">
              <ActionForm
                action={saveSeason}
                submitLabel={t.common.save}
                pendingLabel={t.common.saving}
              >
                <SeasonFields season={season} />
              </ActionForm>
              <ActionButton
                action={deleteSeason}
                fields={{ id: season.id }}
                label={t.common.delete}
                pendingLabel={t.common.deleting}
                variant="danger"
                confirm={r.deleteConfirm}
              />
            </div>
          </details>
        </Panel>
      ))}

      <Panel title={r.seasonAdd}>
        <ActionForm
          action={saveSeason}
          submitLabel={r.seasonAdd}
          pendingLabel={t.common.saving}
          resetOnOk
        >
          <SeasonFields season={{}} />
        </ActionForm>
      </Panel>
    </div>
  );
}
