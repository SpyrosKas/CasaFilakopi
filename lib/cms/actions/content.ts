"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/admin/audit";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { findEmptyLanguages } from "@/lib/cms/checks";
import { findPage } from "@/lib/cms/registry";
import { refreshPublicPages } from "@/lib/cms/refresh";
import {
  cleanBlock,
  discardSchema,
  publishSchema,
  saveDraftSchema,
} from "@/lib/cms/schemas";
import { blockDataSchema } from "@/lib/cms/stored";
import { t } from "@/lib/cms/strings";
import type { BlockData, PageDef } from "@/lib/cms/types";
import type { Json } from "@/lib/db/types";

// Draft, publish and discard. Each write is one statement, so the database
// applies a whole page or none of it. Everything runs through the Owner's own
// client, so RLS applies as well as the check on the first line.

export type ContentResult =
  | { ok: true; dirty: boolean; message?: string }
  | { ok: false; message: string; emptyFields?: string[] };

const failed = (message: string = t.common.somethingWrong): ContentResult => ({
  ok: false,
  message,
});

const asJson = (value: unknown) => value as NonNullable<Json>;

async function pageId(
  admin: AdminContext,
  page: PageDef,
): Promise<string | null> {
  const { data: found } = await admin.supabase
    .from("pages")
    .select("id")
    .eq("slug", page.slug)
    .maybeSingle();
  if (found) return found.id;

  const { data, error } = await admin.supabase
    .from("pages")
    .insert({ slug: page.slug, title: { en: page.label, el: page.label } })
    .select("id")
    .single();
  return error ? null : data.id;
}

async function readRows(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("content_blocks")
    .select("id, page_id, key, draft, published, sort_order")
    .eq("page_id", id);
  if (error) throw error;
  return data;
}

export async function saveDraft(input: unknown): Promise<ContentResult> {
  const admin = await requireOwner();
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  const rows = [];
  const id = await pageId(admin, page);
  if (!id) return failed();

  for (const [key, block] of Object.entries(parsed.data.blocks)) {
    const index = page.sections.findIndex((section) => section.key === key);
    if (index === -1) return failed();
    const cleaned = cleanBlock(page.sections[index], block);
    if ("error" in cleaned) return failed(cleaned.error);
    rows.push({
      page_id: id,
      key,
      draft: asJson(cleaned.data),
      sort_order: index,
    });
  }

  if (rows.length) {
    const { error } = await admin.supabase
      .from("content_blocks")
      .upsert(rows, { onConflict: "page_id,key" });
    if (error) return failed();
  }

  revalidatePath("/admin/content", "layout");
  return { ok: true, dirty: true };
}

/** Steps no longer on the page should not keep their photo in a dead place. */
async function dropRemovedStepPhotos(
  admin: AdminContext,
  page: PageDef,
  published: Record<string, BlockData>,
) {
  const lists = page.sections.filter((section) => section.list?.itemPhotos);
  if (lists.length === 0) return;
  const kept = lists.flatMap((section) =>
    (published[section.key]?.items ?? []).map((item) => `step.${item.id}`),
  );
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("id, collection")
    .like("collection", "step.%");
  if (error) throw error;
  const dead = data.filter((row) => !kept.includes(row.collection));
  if (dead.length) {
    const { error: deleteError } = await admin.supabase
      .from("media_placements")
      .delete()
      .in(
        "id",
        dead.map((row) => row.id),
      );
    if (deleteError) throw deleteError;
  }
}

export async function publishPage(input: unknown): Promise<ContentResult> {
  const admin = await requireOwner();
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  try {
    const id = await pageId(admin, page);
    if (!id) return failed();
    const rows = await readRows(admin, id);

    const drafts = Object.fromEntries(
      rows.flatMap((row) => {
        const block = blockDataSchema.safeParse(row.draft);
        return block.success ? [[row.key, block.data]] : [];
      }),
    );
    const emptyFields = findEmptyLanguages(page, drafts);
    if (emptyFields.length && !parsed.data.confirmedEmpty) {
      return { ok: false, message: t.editor.emptyTitle, emptyFields };
    }

    if (rows.length) {
      const { error } = await admin.supabase
        .from("content_blocks")
        .upsert(rows.map((row) => ({ ...row, published: row.draft })));
      if (error) throw error;
    }
    const { error: pageError } = await admin.supabase
      .from("pages")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (pageError) throw pageError;

    await dropRemovedStepPhotos(admin, page, drafts);
    await writeAudit(admin, {
      action: "publish",
      entity: "pages",
      entityId: id,
      after: { slug: page.slug },
    });
  } catch {
    return failed();
  }

  refreshPublicPages([page.slug]);
  revalidatePath("/admin/content", "layout");
  return { ok: true, dirty: false, message: t.editor.published };
}

export async function discardDraft(input: unknown): Promise<ContentResult> {
  const admin = await requireOwner();
  const parsed = discardSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  try {
    const id = await pageId(admin, page);
    if (!id) return failed();
    const rows = await readRows(admin, id);
    if (rows.length) {
      const { error } = await admin.supabase.from("content_blocks").upsert(
        rows.map((row) => ({
          ...row,
          draft: row.published ?? { en: {}, el: {} },
        })),
      );
      if (error) throw error;
    }
  } catch {
    return failed();
  }

  revalidatePath("/admin/content", "layout");
  return { ok: true, dirty: false, message: t.editor.discarded };
}
