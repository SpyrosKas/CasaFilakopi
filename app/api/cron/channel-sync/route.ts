import { isCronAuthorized } from "@/lib/channels/cron-auth";
import { defaultProvider } from "@/lib/channels/providers";
import { createChannelStore } from "@/lib/channels/store";
import { runDueSyncs } from "@/lib/channels/sync";
import { i18nFor } from "@/lib/admin/i18n";
import { createAdminClient } from "@/lib/db/admin";
import { alertIfRepeating, finishJob, startJob } from "@/lib/email/jobs";
import { loadEmailSettings } from "@/lib/email/settings";
import { logError } from "@/lib/log";

// Runs the feeds that are due (JOB-02). Call it every few minutes: the interval
// Yorgos chose decides which feeds actually go.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves time for a feed that starts just inside the budget to finish. */
const BUDGET_MS = 40_000;

const JOB = "channel_sync";

/**
 * JOB-09. A feed's own trouble shows on Channel sync. This row is for the run
 * itself: one that did work, or one that could not start. Three crashes in a
 * row email the host. A run with nothing due leaves no row.
 */
async function record(failed: boolean, detail: string) {
  const db = createAdminClient();
  const run = await startJob(db, JOB);
  await finishJob(db, run, failed ? "failed" : "success", detail);
  if (failed) {
    const { hostLocale } = await loadEmailSettings(db);
    const label = i18nFor(hostLocale).t.ops.jobs.labels.channel_sync;
    await alertIfRepeating(db, JOB, label, "", new Date());
  }
}

async function run(request: Request) {
  if (
    !isCronAuthorized(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return new Response(null, { status: 401 });
  }

  try {
    const report = await runDueSyncs(
      {
        store: createChannelStore(createAdminClient()),
        provider: defaultProvider(),
      },
      BUDGET_MS,
    );
    if (report.ran > 0) {
      await record(false, JSON.stringify(report)).catch((error) =>
        logError("channel_sync.log_failed", error),
      );
    }
    return Response.json(report, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    await logError("channel_sync.failed", error);
    await record(true, "see logs").catch(() => {});
    return new Response(null, { status: 500 });
  }
}

// Vercel Cron sends GET, pg_net sends POST.
export const GET = run;
export const POST = run;
