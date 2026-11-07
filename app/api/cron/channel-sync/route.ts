import { isCronAuthorized } from "@/lib/channels/cron-auth";
import { defaultProvider } from "@/lib/channels/providers";
import { createChannelStore } from "@/lib/channels/store";
import { runDueSyncs } from "@/lib/channels/sync";
import { createAdminClient } from "@/lib/db/admin";
import { logError } from "@/lib/log";

// Runs the feeds that are due (JOB-02). Call it every few minutes: the interval
// Yorgos chose decides which feeds actually go.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves time for a feed that starts just inside the budget to finish. */
const BUDGET_MS = 40_000;

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
    return Response.json(report, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    await logError("channel_sync.failed", error);
    return new Response(null, { status: 500 });
  }
}

// Vercel Cron sends GET, pg_net sends POST.
export const GET = run;
export const POST = run;
