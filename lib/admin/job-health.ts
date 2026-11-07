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

/** The site's jobs count as silent after this, allowing for one missed run. */
const SITE_SILENT_AFTER_MS = 3 * 60 * 60 * 1000;

export interface JobRun {
  job: string;
  status: string;
  started_at: string;
}

export interface JobHealth {
  failed: { job: DatabaseJob; at: string }[];
  siteSilent: boolean;
}

/** `latest` holds at most one row per job: its most recent run. */
export function summariseJobs(latest: JobRun[], now: Date): JobHealth {
  const heartbeat = latest.find((run) => run.job === HEARTBEAT_JOB);
  return {
    failed: DATABASE_JOBS.flatMap((job) => {
      const run = latest.find((row) => row.job === job);
      return run?.status === "failed" ? [{ job, at: run.started_at }] : [];
    }),
    siteSilent:
      !heartbeat ||
      now.getTime() - new Date(heartbeat.started_at).getTime() >
        SITE_SILENT_AFTER_MS,
  };
}
