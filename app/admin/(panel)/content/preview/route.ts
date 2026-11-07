import { draftMode } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireOwner } from "@/lib/admin/session";
import { findPage } from "@/lib/cms/registry";

const querySchema = z.object({
  page: z.string().max(40),
  lang: z.enum(["en", "el"]),
});

/**
 * Opens the real public page with its drafts. Draft Mode only skips the cache:
 * public pages show drafts when the session is also a signed-in Owner.
 */
export async function GET(request: NextRequest) {
  await requireOwner();
  const query = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const page = query.success ? findPage(query.data.page) : undefined;
  if (!query.success || !page) notFound();

  (await draftMode()).enable();
  redirect(`/${query.data.lang}${page.path ?? ""}`);
}
