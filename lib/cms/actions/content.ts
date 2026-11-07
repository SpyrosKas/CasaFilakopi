"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { i18nFor } from "@/lib/admin/i18n";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { findEmptyLanguages, findMissingRequired } from "@/lib/cms/checks";
import { findPage } from "@/lib/cms/registry";
import { refreshPublicPages } from "@/lib/cms/refresh";
import {
  cleanBlock,
  discardSchema,
  publishSchema,
  saveDraftSchema,
} from "@/lib/cms/schemas";
import { blockDataSchema } from "@/lib/cms/stored";
import type { BlockData, PageDef } from "@/lib/cms/types";
import type { Json } from "@/lib/db/types";
import type { CmsStrings } from "@/lib/cms/strings";

// Draft, publish and discard. Everything runs through the Owner's own client,
// so RLS applies as well as the check on the first line, and the database
// triggers record who published what.
//
// Each block carries the updated_at it was loaded with. A save only lands on
// that exact version, so two open tabs cannot overwrite each other unnoticed.

export type BlockVersions = Record<string, string>;

export type ContentResult =
  | { ok: true; dirty: boolean; versions: BlockVersions; message?: string }
  | {
      ok: false;
      message: string;
      /** Someone else saved this page: stop saving over them. */
      stale?: boolean;
      emptyFields?: string[];
      missingFields?: string[];
      versions?: BlockVersions;
    };

const failure =
  (t: CmsStrings) =>
  (message: string = t.common.somethingWrong): ContentResult => ({
    ok: false,
    message,
  });

const asJson = (value: unknown) => value as NonNullable<Json>;

const UNIQUE_VIOLATION = "23505";

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
    .insert({
      slug: page.slug,
      title: {
        en: i18nFor("en").say(page.label),
        el: i18nFor("el").say(page.label),
      },
    })
    .select("id")
    .single();
  return error ? null : data.id;
}

async function readRows(admin: AdminContext, id: string) {
  const { data, error } = await admin.supabase
    .from("content_blocks")
    .select("id, page_id, key, draft, published, sort_order, updated_at")
    .eq("page_id", id);
  if (error) throw error;
  return data;
}

export async function saveDraft(input: unknown): Promise<ContentResult> {
  const { cms: t, say } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  // Every block is checked before any is written.
  const cleaned: { key: string; index: number; data: BlockData }[] = [];
  for (const [key, block] of Object.entries(parsed.data.blocks)) {
    const index = page.sections.findIndex((section) => section.key === key);
    if (index === -1) return failed();
    const result = cleanBlock(page.sections[index], block);
    if ("error" in result) return failed(say(result.error));
    cleaned.push({ key, index, data: result.data });
  }

  const id = await pageId(admin, page);
  if (!id) return failed();

  const versions: BlockVersions = {};
  const stale = (): ContentResult => ({
    ok: false,
    stale: true,
    message: t.common.pageChanged,
    versions,
  });

  for (const { key, index, data } of cleaned) {
    const version = parsed.data.versions[key];
    if (version) {
      const { data: rows, error } = await admin.supabase
        .from("content_blocks")
        .update({ draft: asJson(data) })
        .eq("page_id", id)
        .eq("key", key)
        .eq("updated_at", version)
        .select("updated_at");
      if (error) return failed();
      if (rows.length === 0) return stale();
      versions[key] = rows[0].updated_at;
    } else {
      const { data: row, error } = await admin.supabase
        .from("content_blocks")
        .insert({ page_id: id, key, draft: asJson(data), sort_order: index })
        .select("updated_at")
        .single();
      if (error?.code === UNIQUE_VIOLATION) return stale();
      if (error) return failed();
      versions[key] = row.updated_at;
    }
  }

  return { ok: true, dirty: true, versions };
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

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export async function publishPage(input: unknown): Promise<ContentResult> {
  const { cms: t, sayAll } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  let id: string | null;
  let rows: Awaited<ReturnType<typeof readRows>>;
  let drafts: Record<string, BlockData>;
  try {
    id = await pageId(admin, page);
    if (!id) return failed();
    rows = await readRows(admin, id);

    drafts = Object.fromEntries(
      rows.flatMap((row) => {
        const block = blockDataSchema.safeParse(row.draft);
        return block.success ? [[row.key, block.data]] : [];
      }),
    );
    const missingFields = findMissingRequired(sayAll(page), drafts, t);
    if (missingFields.length) {
      return { ok: false, message: t.editor.requiredTitle, missingFields };
    }
    const emptyFields = findEmptyLanguages(sayAll(page), drafts, t);
    if (emptyFields.length && !parsed.data.confirmedEmpty) {
      return { ok: false, message: t.editor.emptyTitle, emptyFields };
    }

    // One statement, so the whole page changes or none of it. draft is left
    // out, so a save that lands while this runs is kept, not overwritten.
    if (rows.length) {
      const { error } = await admin.supabase.from("content_blocks").upsert(
        rows.map(({ id: blockId, page_id, key, sort_order, draft }) => ({
          id: blockId,
          page_id,
          key,
          sort_order,
          published: draft,
        })),
      );
      if (error) throw error;
    }
  } catch {
    return failed();
  }

  // The text is out. Nothing below may report failure or skip the refresh.
  refreshPublicPages([page.slug]);
  revalidatePath("/admin/content", "layout");
  await admin.supabase
    .from("pages")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id)
    .then(({ error }) => {
      if (error) console.error("Could not stamp the published time.");
    });
  await dropRemovedStepPhotos(admin, page, drafts).catch(() => {
    console.error("Could not tidy the photos of removed steps.");
  });

  try {
    const after = await readRows(admin, id);
    const newer = after.filter((row) => !sameJson(row.draft, row.published));
    // A block saved elsewhere meanwhile keeps its old version here, so this
    // tab's next save is refused rather than landing on top of it.
    const versions = Object.fromEntries(
      after
        .filter((row) => !newer.includes(row))
        .map((row) => [row.key, row.updated_at]),
    );
    return {
      ok: true,
      dirty: newer.length > 0,
      versions,
      message: newer.length ? t.editor.publishedNewer : t.editor.published,
    };
  } catch {
    return {
      ok: true,
      dirty: false,
      versions: {},
      message: t.editor.published,
    };
  }
}

export async function discardDraft(input: unknown): Promise<ContentResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

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
        rows.map(({ id: blockId, page_id, key, sort_order, published }) => ({
          id: blockId,
          page_id,
          key,
          sort_order,
          draft: published ?? { en: {}, el: {} },
        })),
      );
      if (error) throw error;
    }
  } catch {
    return failed();
  }

  revalidatePath("/admin/content", "layout");
  return { ok: true, dirty: false, versions: {}, message: t.editor.discarded };
}

/**
 * Puts the page's previous published text back into the draft. It goes no
 * further: Yorgos previews it and publishes it like any other change. The
 * audit trigger keeps what each publish replaced, and one publish is one
 * statement, so its rows share a timestamp.
 */
export async function restorePrevious(input: unknown): Promise<ContentResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = discardSchema.safeParse(input);
  if (!parsed.success) return failed();
  const page = findPage(parsed.data.slug)!;

  try {
    const id = await pageId(admin, page);
    if (!id) return failed();
    const rows = await readRows(admin, id);
    const history = await lastPublish(
      admin,
      rows.map((row) => row.id),
    );
    if (history.length === 0) return failed(t.editor.noPrevious);

    for (const { blockId, published } of history) {
      const { error } = await admin.supabase
        .from("content_blocks")
        .update({ draft: asJson(published) })
        .eq("id", blockId);
      if (error) throw error;
    }
  } catch {
    return failed();
  }

  revalidatePath("/admin/content", "layout");
  return { ok: true, dirty: true, versions: {}, message: t.editor.restored };
}

async function lastPublish(admin: AdminContext, blockIds: string[]) {
  if (blockIds.length === 0) return [];
  const { data, error } = await admin.supabase
    .from("audit_log")
    .select("entity_id, before, created_at")
    .eq("entity", "content_blocks")
    .eq("action", "update")
    .in("entity_id", blockIds)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const latest = data[0]?.created_at;
  return data.flatMap((row) => {
    const before = row.before as { published?: unknown } | null;
    const published = blockDataSchema.safeParse(before?.published);
    return row.created_at === latest && row.entity_id && published.success
      ? [{ blockId: row.entity_id, published: before!.published }]
      : [];
  });
}
