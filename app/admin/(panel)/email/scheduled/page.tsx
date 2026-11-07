import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { ActionForm, Field, TextAreaField } from "@/components/admin/form";
import { BOOKING_PLACEHOLDERS } from "@/emails/registry";
import { requireOwner } from "@/lib/admin/session";
import { athensDate } from "@/lib/domain/dates";
import {
  cancelScheduled,
  deleteRule,
  saveRule,
  scheduleOneOff,
} from "@/lib/email/admin-actions";
import { loadScheduledRules, type ScheduledRule } from "@/lib/email/scheduled";

async function PlaceholderList() {
  const { t } = await adminI18n();
  const s = t.email.scheduled;

  return (
    <>
      <p className="hint">{s.placeholders}</p>
      <ul className="eml-chips">
        {BOOKING_PLACEHOLDERS.map((name) => (
          <li key={name}>
            <code>{`{{${name}}}`}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

async function RuleForm({ rule }: { rule?: ScheduledRule }) {
  const { t } = await adminI18n();
  const s = t.email.scheduled;

  const offset = rule?.offsetDays ?? -7;
  return (
    <ActionForm
      action={saveRule}
      submitLabel={s.saveRule}
      pendingLabel={t.common.saving}
    >
      <input type="hidden" name="id" value={rule?.id ?? ""} />
      <Field label={s.name} name="name" defaultValue={rule?.name} />
      <label className="choice">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={rule?.enabled ?? true}
        />
        <span>{s.enabled}</span>
      </label>
      <Field
        label={s.days}
        name="days"
        inputMode="numeric"
        defaultValue={Math.abs(offset)}
      />
      <div className="field">
        <label htmlFor={`direction-${rule?.id ?? "new"}`}>{s.direction}</label>
        <select
          id={`direction-${rule?.id ?? "new"}`}
          name="direction"
          defaultValue={offset <= 0 ? "before" : "after"}
        >
          <option value="before">{s.before}</option>
          <option value="after">{s.after}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`anchor-${rule?.id ?? "new"}`}>{s.anchor}</label>
        <select
          id={`anchor-${rule?.id ?? "new"}`}
          name="anchor"
          defaultValue={rule?.anchor ?? "check_in"}
        >
          <option value="check_in">{s.checkIn}</option>
          <option value="check_out">{s.checkOut}</option>
        </select>
      </div>
      <Field
        label={s.subjectEl}
        name="subject_el"
        defaultValue={rule?.copy.el.subject}
      />
      <TextAreaField
        label={s.bodyEl}
        name="body_el"
        defaultValue={rule?.copy.el.body ?? ""}
      />
      <Field
        label={s.subjectEn}
        name="subject_en"
        defaultValue={rule?.copy.en.subject}
      />
      <TextAreaField
        label={s.bodyEn}
        name="body_en"
        defaultValue={rule?.copy.en.body ?? ""}
      />
      <PlaceholderList />
    </ActionForm>
  );
}

export default async function ScheduledMessagesPage() {
  const { t, formatStamp } = await adminI18n();
  const s = t.email.scheduled;

  const admin = await requireOwner();
  const rules = await loadScheduledRules(admin.supabase);

  const { data: pending, error } = await admin.supabase
    .from("email_logs")
    .select("id, recipient, payload, next_attempt_at")
    .eq("template_key", "scheduled_message")
    .eq("status", "queued")
    .order("next_attempt_at")
    .limit(50);
  if (error) throw error;

  return (
    <div className="stack eml-wide">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/email" prefetch={false} className="text-link">
        {s.back}
      </Link>

      <section className="stack">
        <h2>{s.rulesHeading}</h2>
        {rules.length === 0 && <p>{s.noRules}</p>}
        {rules.map((rule) => (
          <details key={rule.id} className="eml-rule">
            <summary>
              {rule.name}:{" "}
              {s.summary(
                Math.abs(rule.offsetDays),
                rule.offsetDays <= 0,
                rule.anchor === "check_in",
              )}{" "}
              ({rule.enabled ? s.on : s.off})
            </summary>
            <div className="eml-rule-body">
              <RuleForm rule={rule} />
              <form action={deleteRule}>
                <input type="hidden" name="id" value={rule.id} />
                <button type="submit" className="button button-quiet">
                  {s.deleteRule}
                </button>
              </form>
            </div>
          </details>
        ))}
        <details className="eml-rule">
          <summary>{s.addRule}</summary>
          <div className="eml-rule-body">
            <RuleForm />
          </div>
        </details>
      </section>

      <section className="stack">
        <h2>{s.oneOffHeading}</h2>
        <p className="hint">{s.oneOffHint}</p>
        <ActionForm
          action={scheduleOneOff}
          submitLabel={s.queue}
          pendingLabel={t.common.saving}
        >
          <Field label={s.reference} name="reference" />
          <Field
            label={s.date}
            name="date"
            type="date"
            defaultValue={athensDate(new Date())}
          />
          <Field label={s.subject} name="subject" />
          <TextAreaField label={s.body} name="body" defaultValue="" />
          <PlaceholderList />
        </ActionForm>
      </section>

      <section className="stack">
        <h2>{s.pendingHeading}</h2>
        {pending.length === 0 && <p>{s.noPending}</p>}
        <ul className="eml-list">
          {pending.map((row) => (
            <li key={row.id} className="eml-item">
              <div className="eml-item-head">
                <span>
                  {String((row.payload as { subject?: unknown }).subject ?? "")}
                </span>
              </div>
              <p className="eml-meta">{row.recipient}</p>
              <p className="eml-meta">
                {s.goesOut(formatStamp(row.next_attempt_at))}
              </p>
              <form action={cancelScheduled}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="button button-quiet">
                  {s.cancel}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
