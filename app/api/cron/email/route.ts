import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/admin";
import { runEmailQueue } from "@/lib/email";
import { isCronAuthorised } from "@/lib/email/cron-auth";
import { alertIfRepeating, finishJob, startJob } from "@/lib/email/jobs";

export const maxDuration = 60;

const JOB = "email_queue";

/**
 * Sends queued email (JOB-05). Runs every minute, so a run that found nothing
 * leaves no job_runs row. Accepts GET as well, because Vercel Cron only GETs.
 */
async function handle(request: Request) {
  if (
    !isCronAuthorised(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  try {
    const result = await runEmailQueue();
    if (result.claimed > 0) {
      const db = createAdminClient();
      const run = await startJob(db, JOB);
      await finishJob(db, run, "success", JSON.stringify(result));
    }
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`email queue failed: ${detail}`);
    const db = createAdminClient();
    const run = await startJob(db, JOB);
    await finishJob(db, run, "failed", detail);
    await alertIfRepeating(db, JOB, "Email queue", detail, new Date());
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
