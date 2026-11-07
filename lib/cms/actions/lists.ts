"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { loadList, type ListEntry } from "@/lib/cms/data";
import { refreshPublicPages } from "@/lib/cms/refresh";
import {
  listDeleteSchema,
  listEntrySchema,
  listReorderSchema,
  listStatusSchema,
  type ListKind,
} from "@/lib/cms/schemas";
import type { Json } from "@/lib/db/types";
import { later } from "@/lib/admin/later";
import type { CmsStrings } from "@/lib/cms/strings";

// Questions, reviews and places. These tables have a status and no separate
// draft copy, so a saved change to a published entry is live, and the screen
// says so. A new entry starts hidden.

export type ListResult =
  | { ok: true; entries: ListEntry[]; message: string; newId?: string }
  | { ok: false; message: string };

const failure =
  (t: CmsStrings) =>
  (message: string = t.common.somethingWrong): ListResult => ({
    ok: false,
    message,
  });

const publicPage: Record<ListKind, string> = {
  faq: "faq",
  testimonials: "home",
  places: "home",
};

function refresh(kind: ListKind) {
  refreshPublicPages([publicPage[kind]]);
  revalidatePath("/admin/content", "layout");
}

async function nextOrder(admin: AdminContext, kind: ListKind) {
  const { data, error } = await admin.supabase
    .from(kind)
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data[0]?.sort_order ?? -1) + 1;
}

const result = async (
  admin: AdminContext,
  kind: ListKind,
  message: string,
  newId?: string,
): Promise<ListResult> => ({
  ok: true,
  entries: await loadList(admin, kind),
  message,
  newId,
});

export async function saveListEntry(input: unknown): Promise<ListResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = listEntrySchema.safeParse(input);
  if (!parsed.success) {
    const required = parsed.error.issues.some(
      (issue) => issue.message === later.cms.lists.required,
    );
    return failed(required ? t.lists.required : t.common.somethingWrong);
  }
  const entry = parsed.data;

  try {
    let id = entry.id;
    if (entry.kind === "faq") {
      const row = { question: entry.question, answer: entry.answer };
      if (id) {
        const { error } = await admin.supabase
          .from("faq")
          .update(row)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await admin.supabase
          .from("faq")
          .insert({ ...row, sort_order: await nextOrder(admin, "faq") })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
    } else if (entry.kind === "testimonials") {
      const body = {
        en: entry.text.en,
        el: entry.text.el,
        teaser: entry.teaser,
        stars: entry.stars,
      } as unknown as NonNullable<Json>;
      const row = { author: entry.author, body };
      if (id) {
        const { error } = await admin.supabase
          .from("testimonials")
          .update(row)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await admin.supabase
          .from("testimonials")
          .insert({
            ...row,
            sort_order: await nextOrder(admin, "testimonials"),
          })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
    } else {
      const row = {
        name: entry.name,
        description: entry.description,
        media_id: entry.mediaId,
      };
      if (id) {
        const { error } = await admin.supabase
          .from("places")
          .update(row)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await admin.supabase
          .from("places")
          .insert({ ...row, sort_order: await nextOrder(admin, "places") })
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
    }
    refresh(entry.kind);
    return await result(admin, entry.kind, t.lists.saved, id);
  } catch {
    return failed();
  }
}

export async function setListStatus(input: unknown): Promise<ListResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = listStatusSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { kind, id, status } = parsed.data;
  try {
    const { error } = await admin.supabase
      .from(kind)
      .update({ status })
      .eq("id", id);
    if (error) throw error;
    refresh(kind);
    return await result(
      admin,
      kind,
      status === "published" ? t.lists.published : t.lists.hidden,
    );
  } catch {
    return failed();
  }
}

export async function deleteListEntry(input: unknown): Promise<ListResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = listDeleteSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { kind, id } = parsed.data;
  try {
    const { error } = await admin.supabase.from(kind).delete().eq("id", id);
    if (error) throw error;
    refresh(kind);
    return await result(admin, kind, t.lists.deleted);
  } catch {
    return failed();
  }
}

/** Writes every position in one statement, so a reorder lands whole. */
export async function reorderList(input: unknown): Promise<ListResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = listReorderSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { kind, ids } = parsed.data;
  const position = (id: string) => ids.indexOf(id);

  try {
    const same = (current: { id: string }[]) =>
      current.length === ids.length && current.every((r) => ids.includes(r.id));

    if (kind === "faq") {
      const { data, error } = await admin.supabase
        .from("faq")
        .select("id, question, answer, status, sort_order");
      if (error) throw error;
      if (!same(data)) return failed(t.common.pageChanged);
      const { error: writeError } = await admin.supabase.from("faq").upsert(
        data.map((row) => ({
          ...row,
          question: row.question as NonNullable<Json>,
          answer: row.answer as NonNullable<Json>,
          sort_order: position(row.id),
        })),
      );
      if (writeError) throw writeError;
    } else if (kind === "testimonials") {
      const { data, error } = await admin.supabase
        .from("testimonials")
        .select("id, author, body, status, sort_order");
      if (error) throw error;
      if (!same(data)) return failed(t.common.pageChanged);
      const { error: writeError } = await admin.supabase
        .from("testimonials")
        .upsert(
          data.map((row) => ({
            ...row,
            body: row.body as NonNullable<Json>,
            sort_order: position(row.id),
          })),
        );
      if (writeError) throw writeError;
    } else {
      const { data, error } = await admin.supabase
        .from("places")
        .select("id, name, description, media_id, status, sort_order");
      if (error) throw error;
      if (!same(data)) return failed(t.common.pageChanged);
      const { error: writeError } = await admin.supabase.from("places").upsert(
        data.map((row) => ({
          ...row,
          name: row.name as NonNullable<Json>,
          description: row.description as NonNullable<Json>,
          sort_order: position(row.id),
        })),
      );
      if (writeError) throw writeError;
    }
    refresh(kind);
    return await result(admin, kind, t.lists.orderSaved);
  } catch {
    return failed();
  }
}
