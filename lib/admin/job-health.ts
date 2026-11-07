// What Home needs to know about background work (JOB-09). Pure, so the rules
// can be tested without a clock or a database.

/** Jobs that run inside the database and report through job_runs. */
export const DATABASE_JOBS = [
  "release_expired_holds",
  "complete_finished_bookings",
  "purge_admin_attempts",
  "apply_retention",
] as const;

export type DatabaseJob = (typeof DATABASE_JOBS)[number];

/** /api/cron/health writes one of these an hour, whatever else happens. */
export const HEARTBEAT_JOB = "job_health";

/** A site job that also writes a row on every run. */
const SITE_JOB = "scheduled_emails";

export type WatchedJob = DatabaseJob | typeof SITE_JOB;

export const WATCHED_JOBS: readonly WatchedJob[] = [...DATABASE_JOBS, SITE_JOB];

const HOUR_MS = 60 * 60 * 1000;

/** How long each may go without a run, allowing for a missed one or two. */
const MAX_AGE_MS: Record<WatchedJob, number> = {
  release_expired_holds: 3 * HOUR_MS,
  complete_finished_bookings: 30 * HOUR_MS,
  purge_admin_attempts: 30 * HOUR_MS,
  apply_retention: 30 * HOUR_MS,
  scheduled_emails: 3 * HOUR_MS,
};

/** The site's jobs count as silent after this, allowing for one missed run. */
const SITE_SILENT_AFTER_MS = 3 * HOUR_MS;

export interface JobRun {
  job: string;
  status: string;
  started_at: string;
}

export interface JobHealth {
  failed: { job: WatchedJob; at: string }[];
  /** Jobs past their age. A job that has never run is covered by siteSilent. */
  stale: WatchedJob[];
  siteSilent: boolean;
}

/** `latest` holds at most one row per job: its most recent run. */
export function summariseJobs(latest: JobRun[], now: Date): JobHealth {
  const heartbeat = latest.find((run) => run.job === HEARTBEAT_JOB);
  const age = (run: JobRun) => now.getTime() - Date.parse(run.started_at);
  const last = (job: string) => latest.find((run) => run.job === job);
  return {
    failed: WATCHED_JOBS.flatMap((job) => {
      const run = last(job);
      return run?.status === "failed" ? [{ job, at: run.started_at }] : [];
    }),
    stale: WATCHED_JOBS.filter((job) => {
      const run = last(job);
      return run && run.status !== "failed" && age(run) > MAX_AGE_MS[job];
    }),
    siteSilent:
      !heartbeat ||
      heartbeat.status === "failed" ||
      age(heartbeat) > SITE_SILENT_AFTER_MS,
  };
}
