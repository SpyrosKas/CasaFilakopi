import { timingSafeEqual } from "node:crypto";
import { removeOldUploads } from "@/lib/cms/cleanup";
import { createAdminClient } from "@/lib/db/admin";
import { finishJob, startJob } from "@/lib/email/jobs";
import { logError } from "@/lib/log";

const JOB = "cms_cleanup";

/**
 * Daily: clears uploads that were started and never finished. Every run leaves
 * a job_runs row, so Home notices when it stops (JOB-09).
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "not_authorised" }, { status: 401 });
  }
  const db = createAdminClient();
  let run: number | undefined;
  try {
    run = await startJob(db, JOB);
    const removed = await removeOldUploads(
      db.storage.from("uploads-private"),
      Date.now(),
    );
    await finishJob(db, run, "success", `removed ${removed}`);
    return Response.json({ removed });
  } catch (error) {
    await logError("cms_cleanup.failed", error);
    // The hourly health job alerts from this row, in the host's language.
    if (run !== undefined) {
      await finishJob(db, run, "failed", "see logs").catch(() => {});
    }
    return Response.json({ error: "cleanup_failed" }, { status: 500 });
  }
}

// pg_net sends POST; GET is kept for a manual check.
export const GET = handle;
export const POST = handle;
