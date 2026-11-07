import {
  ActionButton,
  ActionForm,
  CheckField,
  Field,
} from "@/components/admin/form";
import { RatesTabs } from "@/components/admin/rates-tabs";
import { Badge, Empty, PageHead, Panel } from "@/components/admin/ui";
import { deleteRestriction, saveRestriction } from "@/lib/admin/actions/rates";
import { formatDate, nightsWord } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

const r = t.rates;
const WEEK = [1, 2, 3, 4, 5, 6, 0];

interface RuleValues {
  id?: string;
  start_date?: string;
  end_date?: string;
  min_stay?: number | null;
  max_stay?: number | null;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  allowed_check_in_days?: number[] | null;
}

function RuleFields({ rule }: { rule: RuleValues }) {
  return (
    <>
      {rule.id && <input type="hidden" name="id" value={rule.id} />}
      <div className="field-row">
        <Field
          label={r.restrictionStart}
          name="from"
          type="date"
          defaultValue={rule.start_date ?? ""}
        />
        <Field
          label={r.restrictionEnd}
          name="to"
          type="date"
          defaultValue={rule.end_date ?? ""}
        />
      </div>
      <div className="field-row">
        <Field
          label={r.minStay}
          name="minStay"
          inputMode="numeric"
          defaultValue={rule.min_stay ?? ""}
        />
        <Field
          label={r.maxStay}
          name="maxStay"
          inputMode="numeric"
          defaultValue={rule.max_stay ?? ""}
        />
      </div>
      <CheckField
        label={r.noArrival}
        name="noArrival"
        defaultChecked={rule.closed_to_arrival}
      />
      <CheckField
        label={r.noDeparture}
        name="noDeparture"
        defaultChecked={rule.closed_to_departure}
      />
      <fieldset>
        <legend>{r.arrivalDays}</legend>
        <p className="hint">{r.arrivalDaysHint}</p>
        <div className="weekday-row">
          {WEEK.map((day) => (
            <CheckField
              key={day}
              label={r.weekdayNames[day]}
              name="days"
              value={String(day)}
              defaultChecked={rule.allowed_check_in_days?.includes(day)}
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}

const ruleBadges = (rule: RuleValues): string[] => [
  ...(rule.min_stay ? [r.ruleMin(nightsWord(rule.min_stay))] : []),
  ...(rule.max_stay ? [r.ruleMax(nightsWord(rule.max_stay))] : []),
  ...(rule.closed_to_arrival ? [r.ruleNoArrival] : []),
  ...(rule.closed_to_departure ? [r.ruleNoDeparture] : []),
  ...(rule.allowed_check_in_days?.length
    ? [
        r.ruleDays(
          WEEK.filter((day) => rule.allowed_check_in_days?.includes(day))
            .map((day) => r.weekdayNames[day])
            .join(", "),
        ),
      ]
    : []),
];

/** Staff may edit these too (ADM-02). */
export default async function RestrictionsPage() {
  const admin = await requireAdmin();
  const { data: rules, error } = await admin.supabase
    .from("restrictions")
    .select(
      "id, start_date, end_date, min_stay, max_stay, closed_to_arrival, closed_to_departure, allowed_check_in_days",
    )
    .order("start_date");
  if (error) throw error;

  return (
    <div className="stack">
      <PageHead title={r.tabs.restrictions} intro={r.restrictionsIntro} />
      <RatesTabs current="restrictions" isOwner={admin.role === "owner"} />

      {rules.length === 0 && <Empty>{r.restrictionsEmpty}</Empty>}
      {rules.map((rule) => (
        <Panel
          key={rule.id}
          title={r.dateRange(
            formatDate(rule.start_date),
            formatDate(rule.end_date),
          )}
        >
          <span className="row-badges">
            {ruleBadges(rule).map((text) => (
              <Badge key={text}>{text}</Badge>
            ))}
          </span>
          <details className="edit-box">
            <summary>{t.common.edit}</summary>
            <div className="card-actions">
              <ActionForm
                action={saveRestriction}
                submitLabel={t.common.save}
                pendingLabel={t.common.saving}
              >
                <RuleFields rule={rule} />
              </ActionForm>
              <ActionButton
                action={deleteRestriction}
                fields={{ id: rule.id }}
                label={t.common.delete}
                pendingLabel={t.common.deleting}
                variant="danger"
                confirm={r.deleteConfirm}
              />
            </div>
          </details>
        </Panel>
      ))}

      <Panel title={r.restrictionAdd}>
        <ActionForm
          action={saveRestriction}
          submitLabel={r.restrictionAdd}
          pendingLabel={t.common.saving}
        >
          <RuleFields rule={{}} />
        </ActionForm>
      </Panel>
    </div>
  );
}
