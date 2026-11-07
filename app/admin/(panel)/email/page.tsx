import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { findTemplate, templateLabel } from "@/emails/registry";
import { requireOwner } from "@/lib/admin/session";
import { ActionForm, Field } from "@/components/admin/form";
import { resendConfirmation, retryEmail } from "@/lib/email/admin-actions";
import { selectTransport } from "@/lib/email/transport";
import { SKIPPED_PREFIX } from "@/lib/email/worker";

const STATUSES = ["queued", "sent", "delivered", "bounced", "failed"] as const;

const SHOWN = 100;

function badge(status: string) {
  if (status === "failed" || status === "bounced") return "eml-badge-bad";
  if (status === "sent" || status === "delivered") return "eml-badge-ok";
  return "";
}

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, lang, formatStamp } = await adminI18n();
  const s = t.email.log;

  const admin = await requireOwner();
  const { status } = await searchParams;
  const filter = STATUSES.find((value) => value === status);

  let query = admin.supabase
    .from("email_logs")
    .select(
      "id, template_key, recipient, status, attempts, last_error, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(SHOWN);
  if (filter) query = query.eq("status", filter);
  const { data: rows, error } = await query;
  if (error) throw error;

  const { count: failures, error: countError } = await admin.supabase
    .from("email_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .not("last_error", "like", `${SKIPPED_PREFIX}%`);
  if (countError) throw countError;

  const { count: bounces, error: bounceError } = await admin.supabase
    .from("email_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "bounced");
  if (bounceError) throw bounceError;

  const needAttention = (failures ?? 0) + (bounces ?? 0);

  // A refused key leaves the rows queued, so only the last run shows it.
  const { data: lastRun, error: runError } = await admin.supabase
    .from("job_runs")
    .select("status, detail")
    .eq("job", "email_queue")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;
  const keyRefused =
    lastRun?.status === "failed" && !!lastRun.detail?.includes("config_error");

  const transport = selectTransport();

  return (
    <div className="stack eml-wide">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <ul className="eml-links">
        <li>
          <Link
            href="/admin/email/settings"
            prefetch={false}
            className="button button-quiet"
          >
            {s.settingsLink}
          </Link>
        </li>
        <li>
          <Link
            href="/admin/email/templates"
            prefetch={false}
            className="button button-quiet"
          >
            {s.templatesLink}
          </Link>
        </li>
        <li>
          <Link
            href="/admin/email/scheduled"
            prefetch={false}
            className="button button-quiet"
          >
            {s.scheduledLink}
          </Link>
        </li>
      </ul>

      {!transport && <p className="notice notice-bad">{s.notConnected}</p>}
      {keyRefused && <p className="notice notice-bad">{s.keyProblem}</p>}
      {transport && transport.name !== "resend" && (
        <p className="notice notice-info">{s.testMode(transport.name)}</p>
      )}
      {needAttention > 0 && (
        <p className="notice notice-bad">{s.needsAttention(needAttention)}</p>
      )}

      <section className="stack">
        <h2>{s.resendHeading}</h2>
        <p className="hint">{s.resendHint}</p>
        <ActionForm
          action={resendConfirmation}
          submitLabel={s.resendSubmit}
          pendingLabel={t.common.saving}
        >
          <Field label={t.email.scheduled.reference} name="reference" />
        </ActionForm>
      </section>

      <ul className="eml-filters">
        <li>
          <Link href="/admin/email" prefetch={false} aria-current={!filter}>
            {s.all}
          </Link>
        </li>
        {STATUSES.map((value) => (
          <li key={value}>
            <Link
              href={`/admin/email?status=${value}`}
              prefetch={false}
              aria-current={filter === value}
            >
              {s.status[value]}
            </Link>
          </li>
        ))}
      </ul>

      {rows.length === 0 && <p>{s.empty}</p>}
      <ul className="eml-list">
        {rows.map((row) => {
          const skipped = row.last_error?.startsWith(SKIPPED_PREFIX);
          const known = findTemplate(row.template_key);
          const label = skipped
            ? s.status.skipped
            : (s.status[row.status as keyof typeof s.status] ?? row.status);
          return (
            <li key={row.id} className="eml-item">
              <div className="eml-item-head">
                <span>
                  {known ? templateLabel(known, lang) : row.template_key}
                </span>
                <span
                  className={`eml-badge ${skipped ? "" : badge(row.status)}`}
                >
                  {label}
                </span>
              </div>
              <p className="eml-meta">
                {s.to}: {row.recipient}
              </p>
              <p className="eml-meta">
                {s.when}: {formatStamp(row.created_at)}
                {row.attempts > 1 && ` · ${s.attempts}: ${row.attempts}`}
              </p>
              {row.last_error && (
                <p className="eml-meta">
                  {s.error}: {row.last_error.replace(SKIPPED_PREFIX, "").trim()}
                </p>
              )}
              {(row.status === "failed" || row.status === "bounced") &&
                !skipped && (
                  <form action={retryEmail}>
                    <input type="hidden" name="id" value={row.id} />
                    <button type="submit" className="button button-quiet">
                      {s.resend}
                    </button>
                  </form>
                )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
