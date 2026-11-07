import { loadExportFeed } from "@/lib/channels/export";
import { createAdminClient } from "@/lib/db/admin";
import { logError } from "@/lib/log";

// The feed Airbnb and Booking.com fetch (CHN-10). No login: the file name holds
// a long secret, and proxy.ts leaves /api alone. Read fresh on every request so
// a new booking shows at the channel's next fetch (AVL-08).
export const dynamic = "force-dynamic";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;

  let body: string | null;
  try {
    body = await loadExportFeed(createAdminClient(), file, new Date());
  } catch (error) {
    // Never logs the file name: it holds the token. A 503 tells the channel to
    // keep what it has, where an empty calendar would open every date.
    await logError("ical_export.failed", error);
    return new Response("Try again later", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
  if (body === null) return notFound();

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="casa-filakopi.ics"',
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
