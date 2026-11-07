import {
  HEARTBEAT_JOB,
  WATCHED_JOBS,
  type JobRun,
} from "@/lib/admin/job-health";
import { athensDate } from "@/lib/domain/dates";
import type { EmailDb } from "./db";
import { queueEmailWith } from "./queue";

// JOB-09: runs are logged, and repeated failures alert the host.

const ALERT_AFTER_FAILURES = 3;

export async function startJob(db: EmailDb, job: string): Promise<number> {
  const { data, error } = await db
    .from("job_runs")
    .insert({ job })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function finishJob(
  db: EmailDb,
  id: number,
  status: "success" | "failed",
  detail: string,
): Promise<void> {
  const { error } = await db
    .from("job_runs")
    .update({
      status,
      detail: detail.slice(0, 2000),
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** The last run of each watched job, one query each. */
export async function latestRuns(db: EmailDb): Promise<JobRun[]> {
  const rows = await Promise.all(
    [...WATCHED_JOBS, HEARTBEAT_JOB].map(async (job) => {
      const { data, error } = await db
        .from("job_runs")
        .select("job, status, started_at")
        .eq("job", job)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }),
  );
  return rows.filter((run) => run !== null);
}

/** A job past its age has nothing to count as failures, so it says so itself. */
export async function alertStaleJob(
  db: EmailDb,
  job: string,
  label: string,
  now: Date,
): Promise<boolean> {
  const result = await queueEmailWith(
    db,
    "host_job_failure",
    { job: label, failures: 1, error: "It has not run on time." },
    { dedupeKey: `job-stale:${job}:${athensDate(now)}` },
  );
  return result.ok;
}

/**
 * For jobs that run in the database, which cannot send email themselves. True
 * when the job has failed enough times in a row to be worth an alert.
 */
export async function alertAboutJob(
  db: EmailDb,
  job: string,
  label: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from("job_runs")
    .select("status, detail")
    .eq("job", job)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.status !== "failed") return false;
  return alertIfRepeating(db, job, label, data.detail ?? "", now);
}

/** One alert a day per job, once the last few runs have all failed. */
export async function alertIfRepeating(
  db: EmailDb,
  job: string,
  label: string,
  detail: string,
  now: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from("job_runs")
    .select("status")
    .eq("job", job)
    .order("id", { ascending: false })
    .limit(ALERT_AFTER_FAILURES);
  if (error) throw new Error(error.message);

  const repeating =
    data.length === ALERT_AFTER_FAILURES &&
    data.every((run) => run.status === "failed");
  if (!repeating) return false;

  const result = await queueEmailWith(
    db,
    "host_job_failure",
    {
      job: label,
      failures: ALERT_AFTER_FAILURES,
      ...(detail.trim() ? { error: detail.trim().slice(0, 500) } : {}),
    },
    { dedupeKey: `job-alert:${job}:${athensDate(now)}` },
  );
  return result.ok;
}
