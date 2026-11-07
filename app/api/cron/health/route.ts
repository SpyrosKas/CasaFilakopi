import { NextResponse } from "next/server";
import {
  HEARTBEAT_JOB,
  summariseJobs,
  WATCHED_JOBS,
} from "@/lib/admin/job-health";
import { t } from "@/lib/admin/strings";
import { createAdminClient } from "@/lib/db/admin";
import { isCronAuthorised } from "@/lib/email/cron-auth";
import { emailSecrets } from "@/lib/email/env";
import {
  alertAboutJob,
  alertStaleJob,
  finishJob,
  latestRuns,
  startJob,
} from "@/lib/email/jobs";
import { logError, logInfo } from "@/lib/log";

export const maxDuration = 60;

/**
 * JOB-09. Database jobs cannot send email, so this reads how they went and
 * alerts the host about repeated failures. Hourly. Its own row in job_runs is
 * the heartbeat that tells Home the site's jobs are running.
 */
async function handle(request: Request) {
  if (
    !isCronAuthorised(
      request.headers.get("authorization"),
      emailSecrets().cronSecret,
    )
  ) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const db = createAdminClient();
  let run: number | undefined;
  try {
    run = await startJob(db, HEARTBEAT_JOB);
    const now = new Date();
    const { labels } = t.ops.jobs;
    const { stale } = summariseJobs(await latestRuns(db), now);
    const alerted = (
      await Promise.all([
        ...WATCHED_JOBS.map((job) => alertAboutJob(db, job, labels[job], now)),
        ...stale.map((job) => alertStaleJob(db, job, labels[job], now)),
      ])
    ).filter(Boolean).length;
    await finishJob(db, run, "success", `alerted ${alerted}`);
    logInfo("job_health.done", { alerted });
    return NextResponse.json({ alerted });
  } catch (error) {
    await logError("job_health.failed", error);
    if (run !== undefined) await finishJob(db, run, "failed", "see logs");
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
