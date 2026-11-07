import { timingSafeEqual } from "node:crypto";
import { removeOldUploads } from "@/lib/cms/cleanup";
import { createAdminClient } from "@/lib/db/admin";

/** Daily: clears uploads that were started and never finished. */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "not_authorised" }, { status: 401 });
  }
  try {
    const storage = createAdminClient().storage.from("uploads-private");
    const removed = await removeOldUploads(storage, Date.now());
    return Response.json({ removed });
  } catch {
    return Response.json({ error: "cleanup_failed" }, { status: 500 });
  }
}
