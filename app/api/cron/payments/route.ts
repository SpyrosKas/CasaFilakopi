import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/admin";
import { isCronAuthorised } from "@/lib/email/cron-auth";
import { emailSecrets } from "@/lib/email/env";
import { alertIfRepeating, finishJob, startJob } from "@/lib/email/jobs";
import { rpc } from "@/lib/payments/deps";
import { resumeStaleRefunds } from "@/lib/payments/refunds";
import { paymentDeps } from "@/lib/payments/server";

export const maxDuration = 60;

const JOB = "payments";

/**
 * Tidies up what a missed webhook or a crash can leave (JOB-01). Run every 5
 * minutes. Hold expiry itself needs no job: create_hold clears expired holds
 * and availability ignores them. This turns them into `expired` bookings with
 * their promo use given back, and finishes refunds that lost their answer.
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
  try {
    const deps = paymentDeps();
    const holds = await rpc<number>(deps, "release_expired_holds", {});
    const refunds = deps.stripe
      ? await resumeStaleRefunds(deps)
      : { checked: 0, failed: 0 };

    const result = { holds, refunds };
    if (holds > 0 || refunds.checked > 0) {
      const run = await startJob(db, JOB);
      const failed = refunds.failed > 0;
      const detail = JSON.stringify(result);
      await finishJob(db, run, failed ? "failed" : "success", detail);
      if (failed) {
        await alertIfRepeating(db, JOB, "Payments", detail, new Date());
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`payments job failed: ${detail}`);
    const run = await startJob(db, JOB);
    await finishJob(db, run, "failed", detail);
    await alertIfRepeating(db, JOB, "Payments", detail, new Date());
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
