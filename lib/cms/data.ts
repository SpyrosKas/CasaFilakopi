import "server-only";
import type { AdminContext } from "@/lib/admin/session";
import { defaultPageBlocks } from "@/lib/cms/defaults";
import { publicMediaUrl } from "@/lib/cms/media-url";
import {
  collectionName,
  findCollection,
  fixedCollections,
} from "@/lib/cms/registry";
import { blockDataSchema, reviewBodySchema } from "@/lib/cms/stored";
import { t } from "@/lib/cms/strings";
import type { ListKind } from "@/lib/cms/schemas";
import type { BlockData, CollectionDef, Lang, PageDef } from "@/lib/cms/types";

// Reads for the text and photo screens, through the Owner's own client.

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const toBlock = (value: unknown): BlockData | null => {
  const parsed = blockDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export interface EditorData {
  blocks: Record<string, BlockData>;
  dirty: boolean;
}

export async function loadEditor(
  admin: AdminContext,
  page: PageDef,
): Promise<EditorData> {
  const { data, error } = await admin.supabase
    .from("content_blocks")
    .select("key, draft, published, pages!inner(slug)")
    .eq("pages.slug", page.slug);
  if (error) throw error;

  const defaults = defaultPageBlocks(page.slug);
  const blocks: Record<string, BlockData> = {};
  for (const section of page.sections) {
    const row = data.find((candidate) => candidate.key === section.key);
    blocks[section.key] = (row && toBlock(row.draft)) ??
      defaults[section.key] ?? { en: {}, el: {} };
  }
  const dirty = data.some((row) => !sameJson(row.draft, row.published));
  return { blocks, dirty };
}

/** Slugs of the pages with text waiting to be published. */
export async function loadDirtyPages(admin: AdminContext): Promise<string[]> {
  const { data, error } = await admin.supabase
    .from("content_blocks")
    .select("draft, published, pages!inner(slug)");
  if (error) throw error;
  const dirty = data
    .filter((row) => !sameJson(row.draft, row.published))
    .map((row) => row.pages.slug);
  return [...new Set(dirty)];
}

export interface PhotoItem {
  mediaId: string;
  src: string;
  width: number;
  height: number;
  alt: { en: string; el: string };
  /** Other places this photo appears. */
  usedElsewhere: string[];
  /** True when it is the only photo of a place that must have one. */
  blockedBy: string[];
}

interface MediaRow {
  id: string;
  path: string;
  width: number | null;
  height: number | null;
  alt: unknown;
}

const altOf = (value: unknown) => {
  const alt = (value ?? {}) as Partial<Record<Lang, string>>;
  return { en: alt.en ?? "", el: alt.el ?? "" };
};

async function usageOf(admin: AdminContext, ids: string[]) {
  const [placements, places] = await Promise.all([
    admin.supabase
      .from("media_placements")
      .select("collection, media_id")
      .in("media_id", ids),
    admin.supabase.from("places").select("name, media_id").in("media_id", ids),
  ]);
  if (placements.error) throw placements.error;
  if (places.error) throw places.error;

  return (mediaId: string, current?: string) => {
    const own = placements.data.filter((p) => p.media_id === mediaId);
    const placeNames = places.data
      .filter((place) => place.media_id === mediaId)
      .map((place) =>
        t.photos.place(altOf(place.name).en || altOf(place.name).el),
      );
    return {
      usedElsewhere: [
        ...own
          .filter((p) => p.collection !== current)
          .map((p) => collectionName(p.collection)),
        ...placeNames,
      ],
      blockedBy: own
        .filter((p) => {
          const def = findCollection(p.collection);
          return def?.single && !def.optional;
        })
        .map((p) => collectionName(p.collection)),
    };
  };
}

export async function loadCollection(
  admin: AdminContext,
  collection: string,
): Promise<PhotoItem[]> {
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("media(id, path, width, height, alt)")
    .eq("collection", collection)
    .order("sort_order");
  if (error) throw error;

  const rows = data.flatMap((row) => (row.media ? [row.media] : []));
  if (rows.length === 0) return [];
  const usage = await usageOf(
    admin,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toItem(row, usage(row.id, collection)));
}

function toItem(
  row: MediaRow,
  usage: Pick<PhotoItem, "usedElsewhere" | "blockedBy">,
): PhotoItem {
  return {
    mediaId: row.id,
    src: publicMediaUrl(row.path),
    width: row.width ?? 1600,
    height: row.height ?? 1067,
    alt: altOf(row.alt),
    ...usage,
  };
}

export interface CollectionSummary {
  def: CollectionDef;
  count: number;
  needsText: number;
  cover: { src: string; width: number; height: number } | null;
}

export async function loadPhotoOverview(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("collection, sort_order, media(path, width, height, alt)")
    .order("sort_order");
  if (error) throw error;

  const summaries: CollectionSummary[] = fixedCollections().map((def) => {
    const rows = data.filter((row) => row.collection === def.id);
    const first = rows[0]?.media;
    return {
      def,
      count: rows.length,
      needsText: def.decorative
        ? 0
        : rows.filter((row) => {
            const alt = altOf(row.media?.alt);
            return !alt.en || !alt.el;
          }).length,
      cover: first
        ? {
            src: publicMediaUrl(first.path),
            width: first.width ?? 1600,
            height: first.height ?? 1067,
          }
        : null,
    };
  });

  return { summaries, unused: (await loadUnused(admin)).length };
}

function unusedQuery(admin: AdminContext) {
  return admin.supabase
    .from("media")
    .select("id, path, width, height, alt, media_placements!left(id)")
    .eq("bucket", "media")
    .is("media_placements", null)
    .order("created_at", { ascending: false });
}

export async function loadUnused(admin: AdminContext): Promise<PhotoItem[]> {
  const { data, error } = await unusedQuery(admin);
  if (error) throw error;
  if (data.length === 0) return [];
  const usage = await usageOf(
    admin,
    data.map((row) => row.id),
  );
  return data
    .map((row) => toItem(row, usage(row.id)))
    .filter((item) => item.usedElsewhere.length === 0);
}

export interface ListEntry {
  id: string;
  status: "draft" | "published";
  values: Record<string, string>;
  mediaId?: string | null;
}

const localized = (value: unknown, prefix: string) => {
  const { en, el } = altOf(value);
  return { [`${prefix}_en`]: en, [`${prefix}_el`]: el };
};

export async function loadList(
  admin: AdminContext,
  kind: ListKind,
): Promise<ListEntry[]> {
  if (kind === "faq") {
    const { data, error } = await admin.supabase
      .from("faq")
      .select("id, question, answer, status")
      .order("sort_order");
    if (error) throw error;
    return data.map((row) => ({
      id: row.id,
      status: row.status,
      values: {
        ...localized(row.question, "question"),
        ...localized(row.answer, "answer"),
      },
    }));
  }
  if (kind === "testimonials") {
    const { data, error } = await admin.supabase
      .from("testimonials")
      .select("id, author, body, status")
      .order("sort_order");
    if (error) throw error;
    return data.map((row) => {
      const body = reviewBodySchema.parse(row.body);
      return {
        id: row.id,
        status: row.status,
        values: {
          author: row.author,
          stars: String(body.stars),
          text_en: body.en,
          text_el: body.el,
          teaser_en: body.teaser.en,
          teaser_el: body.teaser.el,
        },
      };
    });
  }
  const { data, error } = await admin.supabase
    .from("places")
    .select("id, name, description, media_id, status")
    .order("sort_order");
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    status: row.status,
    mediaId: row.media_id,
    values: {
      ...localized(row.name, "name"),
      ...localized(row.description, "description"),
    },
  }));
}

/** Small list of every photo, to choose one for a place. */
export async function loadPhotoChoices(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("media")
    .select("id, path, width, height")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    src: publicMediaUrl(row.path),
    width: row.width ?? 1600,
    height: row.height ?? 1067,
  }));
}
