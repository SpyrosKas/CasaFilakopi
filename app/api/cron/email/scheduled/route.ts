import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/admin";
import { isCronAuthorised } from "@/lib/email/cron-auth";
import { emailSecrets } from "@/lib/email/env";
import { alertIfRepeating, finishJob, startJob } from "@/lib/email/jobs";
import { sendScheduledEmails } from "@/lib/email/scheduled";

export const maxDuration = 60;

const JOB = "scheduled_emails";

/** Queues balance, pre-arrival and rule emails (JOB-03, JOB-04, T5.8a). */
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
  const now = new Date();
  const run = await startJob(db, JOB);
  try {
    const result = await sendScheduledEmails(db, now);
    await finishJob(db, run, "success", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`scheduled emails failed: ${detail}`);
    await finishJob(db, run, "failed", detail);
    await alertIfRepeating(db, JOB, "Scheduled emails", detail, now);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
