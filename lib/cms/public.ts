import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { cache } from "react";
import { resolveAdminSession } from "@/lib/admin/session";
import {
  defaultCollection,
  defaultPageBlocks,
  defaultReviews,
  phoneLink,
  whatsappLink,
} from "@/lib/cms/defaults";
import { publicMediaUrl } from "@/lib/cms/media-url";
import { recover } from "@/lib/cms/runtime";
import { findPage } from "@/lib/cms/registry";
import { blockDataSchema, reviewBodySchema } from "@/lib/cms/stored";
import type {
  BlockData,
  FieldValues,
  Lang,
  PageDef,
  SitePhoto,
} from "@/lib/cms/types";
import type { Database } from "@/lib/db/types";
import { getPublicEnv } from "@/lib/env";

// How public pages read content (WEB-07). Visitors get an anon client with
// named columns, so RLS and the column grant keep drafts out of reach.
//
// If the database cannot be reached, lib/cms/runtime.ts decides: a build uses
// the built-in text, and a running site throws, which keeps the last good page
// when Next regenerates it in the background. With no earlier page to keep,
// such as one just purged by a publish, app/[locale]/error.tsx shows inside the
// layout, which never depends on the database. Nothing is cached in that case,
// so the next visitor gets the real page once the database is back. The
// [locale] layout's hourly revalidate replaces anything built with built-in
// text.
//
// Drafts are read only in Draft Mode by a signed-in Owner, through that
// Owner's own client. The Draft Mode cookie alone unlocks nothing.

const READ_TIMEOUT_MS = 5000;

function anonClient() {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
          }),
      },
    },
  );
}

type AnyClient = ReturnType<typeof anonClient>;

/** The Owner's client while previewing, otherwise null. */
const previewClient = cache(async (): Promise<AnyClient | null> => {
  const { isEnabled } = await draftMode();
  if (!isEnabled) return null;
  const session = await resolveAdminSession();
  return session.state === "ready" && session.role === "owner"
    ? (session.supabase as unknown as AnyClient)
    : null;
});

export const isPreviewing = async () => (await previewClient()) !== null;

async function readBlocks(
  client: AnyClient,
  slug: string,
  preview: boolean,
): Promise<Record<string, BlockData>> {
  const query = preview
    ? client
        .from("content_blocks")
        .select("key, draft, pages!inner(slug)")
        .eq("pages.slug", slug)
    : client
        .from("content_blocks")
        .select("key, published, pages!inner(slug)")
        .eq("pages.slug", slug);
  const { data, error } = await query;
  if (error) throw error;

  const blocks: Record<string, BlockData> = {};
  for (const row of data as { key: string; [column: string]: unknown }[]) {
    const stored = preview ? row.draft : row.published;
    const parsed = blockDataSchema.safeParse(stored);
    if (parsed.success) blocks[row.key] = parsed.data;
  }
  return blocks;
}

async function readPhotos(
  client: AnyClient,
  collections: string[],
  lang: Lang,
): Promise<Record<string, SitePhoto[]>> {
  const { data, error } = await client
    .from("media_placements")
    .select("collection, sort_order, media(path, width, height, alt)")
    .in("collection", collections)
    .order("sort_order");
  if (error) throw error;

  const photos: Record<string, SitePhoto[]> = {};
  for (const row of data) {
    if (!row.media) continue;
    const alt = row.media.alt as Record<string, string>;
    (photos[row.collection] ??= []).push({
      src: publicMediaUrl(row.media.path),
      width: row.media.width ?? 1600,
      height: row.media.height ?? 1067,
      alt: alt[lang] ?? "",
    });
  }
  return photos;
}

function collectionsOf(page: PageDef, blocks: Record<string, BlockData>) {
  return page.sections.flatMap((section) => [
    ...(section.photos ? [section.photos] : []),
    ...(section.list?.itemPhotos
      ? (blocks[section.key]?.items ?? []).map((item) => `step.${item.id}`)
      : []),
  ]);
}

export interface PageItem {
  id: string;
  choice: string | undefined;
  text(field: string): string;
}

export interface PageView {
  /** Text from the database, or the built-in copy. */
  source: "database" | "defaults";
  text(section: string, field: string): string;
  items(section: string): PageItem[];
  photos(collection: string): SitePhoto[];
  photo(collection: string): SitePhoto | null;
}

const otherLang = (lang: Lang): Lang => (lang === "en" ? "el" : "en");

function pick(
  values: Record<Lang, FieldValues>,
  field: string,
  lang: Lang,
  strict: boolean,
): string {
  const value = values[lang]?.[field];
  if (value?.trim() || strict) return value ?? "";
  return values[otherLang(lang)]?.[field] ?? "";
}

function makeView(
  page: PageDef,
  blocks: Record<string, BlockData>,
  photos: Record<string, SitePhoto[]>,
  lang: Lang,
  source: PageView["source"],
): PageView {
  const fieldOf = (section: string, field: string) =>
    page.sections
      .find((candidate) => candidate.key === section)
      ?.fields.find((candidate) => candidate.name === field);

  return {
    source,
    text(section, field) {
      const block = blocks[section];
      if (!block) return "";
      const def = fieldOf(section, field);
      if (def?.shared) return block.shared?.[field] ?? "";
      return pick(block, field, lang, def?.strict ?? false);
    },
    items(section) {
      return (blocks[section]?.items ?? []).map((item) => ({
        id: item.id,
        choice: item.choice,
        text: (field: string) => pick(item, field, lang, false),
      }));
    },
    photos: (collection) => photos[collection] ?? [],
    photo: (collection) => photos[collection]?.[0] ?? null,
  };
}

function defaultView(page: PageDef, lang: Lang): PageView {
  const blocks = defaultPageBlocks(page.slug);
  const photos = Object.fromEntries(
    collectionsOf(page, blocks).map((collection) => [
      collection,
      defaultCollection(collection, lang),
    ]),
  );
  return makeView(page, blocks, photos, lang, "defaults");
}

async function readView(
  page: PageDef,
  lang: Lang,
  client: AnyClient,
  preview: boolean,
): Promise<PageView> {
  const blocks = await readBlocks(client, page.slug, preview);
  if (Object.keys(blocks).length === 0) return defaultView(page, lang);

  const collections = collectionsOf(page, blocks);
  const photos = collections.length
    ? await readPhotos(client, collections, lang)
    : {};
  // Every migrated page keeps a photo: its hero can be replaced, not removed.
  // No photo row at all means the photos have not been imported yet.
  const importedYet = Object.keys(photos).length > 0;
  const shown =
    importedYet || collections.length === 0
      ? photos
      : Object.fromEntries(
          collections.map((collection) => [
            collection,
            defaultCollection(collection, lang),
          ]),
        );
  return makeView(page, blocks, shown, lang, "database");
}

export const loadPage = cache(
  async (slug: string, locale: string): Promise<PageView> => {
    const page = findPage(slug);
    if (!page) throw new Error(`Unknown page ${slug}`);
    const lang = locale as Lang;

    try {
      const preview = await previewClient();
      return await readView(
        page,
        lang,
        preview ?? anonClient(),
        Boolean(preview),
      );
    } catch (error) {
      return recover(`page ${slug}`, error, () => defaultView(page, lang));
    }
  },
);

/** Title, description and sharing photo from the page's SEO fields. */
export async function pageMetadata(
  slug: string,
  locale: string,
  fallbackTitle: string,
): Promise<Metadata> {
  const page = await loadPage(slug, locale);
  const title = page.text("seo", "metaTitle") || fallbackTitle;
  const description = page.text("seo", "metaDescription") || undefined;
  const image = page.photo(`og.${slug}`);
  return {
    title,
    description,
    openGraph: image
      ? { title, description, images: [{ url: image.src }] }
      : undefined,
  };
}

export interface SiteContact {
  email: string;
  phoneDisplay: string;
  phoneHref: string;
  whatsappDisplay: string;
  whatsappHref: string;
  facebook: string;
  instagram: string;
  addressLine1: string;
  addressLine2: string;
}

export async function loadContact(locale: string): Promise<SiteContact> {
  return contactFrom(await loadPage("site", locale));
}

/**
 * The header and footer must render even when the page inside them fails, or
 * the error screen itself could not show. So the layout never throws here.
 */
export async function loadContactForLayout(
  locale: string,
): Promise<SiteContact> {
  try {
    return await loadContact(locale);
  } catch {
    return contactFrom(defaultView(findPage("site")!, locale as Lang));
  }
}

function contactFrom(site: PageView): SiteContact {
  const phone = site.text("contact", "phone");
  const whatsapp = site.text("contact", "whatsapp");
  return {
    email: site.text("contact", "email"),
    phoneDisplay: phone,
    phoneHref: phoneLink(phone),
    whatsappDisplay: whatsapp,
    whatsappHref: whatsappLink(whatsapp),
    facebook: site.text("contact", "facebook"),
    instagram: site.text("contact", "instagram"),
    addressLine1: site.text("address", "line1"),
    addressLine2: site.text("address", "line2"),
  };
}

async function clientForLists() {
  const preview = await previewClient();
  return { client: preview ?? anonClient(), preview: Boolean(preview) };
}

const localized = (value: unknown, lang: Lang): string => {
  const values = (value ?? {}) as Record<string, unknown>;
  const text = values[lang];
  return typeof text === "string" ? text : "";
};

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
}

/** Only questions written in this language. Empty means the page says so. */
export const loadFaq = cache(async (locale: string): Promise<FaqEntry[]> => {
  const lang = locale as Lang;
  try {
    const { client, preview } = await clientForLists();
    const query = client
      .from("faq")
      .select("id, question, answer, status")
      .order("sort_order");
    const { data, error } = await (preview
      ? query
      : query.eq("status", "published"));
    if (error) throw error;
    return data
      .map((row) => ({
        id: row.id,
        question: localized(row.question, lang),
        answer: localized(row.answer, lang),
      }))
      .filter((row) => row.question.trim() && row.answer.trim());
  } catch (error) {
    return recover("questions", error, () => []);
  }
});

export interface ReviewEntry {
  id: string;
  author: string;
  stars: number;
  teaser: string;
  text: string;
  /** Set when the words shown are not in the page's language. */
  textLang: string | undefined;
}

function builtInReviews(lang: Lang): ReviewEntry[] {
  return defaultReviews().map((review) => ({
    id: review.key,
    author: review.author,
    stars: review.stars,
    teaser: review[lang].teaser,
    text: review[lang].text,
    textLang: lang === "en" ? undefined : "en",
  }));
}

export const loadReviews = cache(
  async (locale: string): Promise<ReviewEntry[]> => {
    const lang = locale as Lang;
    try {
      const home = await loadPage("home", locale);
      if (home.source === "defaults") return builtInReviews(lang);

      const { client, preview } = await clientForLists();
      const query = client
        .from("testimonials")
        .select("id, author, body, status")
        .order("sort_order");
      const { data, error } = await (preview
        ? query
        : query.eq("status", "published"));
      if (error) throw error;

      return data.flatMap((row) => {
        const body = reviewBodySchema.safeParse(row.body);
        if (!body.success) return [];
        const other = otherLang(lang);
        const hasOwnText = body.data[lang].trim() !== "";
        const shown = hasOwnText ? lang : other;
        // A guest's own words stay in their language, and the page says which.
        const sameAsEnglish = body.data.el.trim() === body.data.en.trim();
        const textLang =
          shown === "en" || sameAsEnglish
            ? lang === "en"
              ? undefined
              : "en"
            : undefined;
        return [
          {
            id: row.id,
            author: row.author,
            stars: body.data.stars,
            teaser: body.data.teaser[shown] || body.data[shown],
            text: body.data[shown],
            textLang,
          },
        ];
      });
    } catch (error) {
      return recover("reviews", error, () => builtInReviews(lang));
    }
  },
);

export interface PlaceEntry {
  id: string;
  name: string;
  description: string;
  photo: SitePhoto | null;
}

export const loadPlaces = cache(
  async (locale: string): Promise<PlaceEntry[]> => {
    const lang = locale as Lang;
    try {
      const { client, preview } = await clientForLists();
      const query = client
        .from("places")
        .select(
          "id, name, description, status, media(path, width, height, alt)",
        )
        .order("sort_order");
      const { data, error } = await (preview
        ? query
        : query.eq("status", "published"));
      if (error) throw error;
      return data
        .map((row) => ({
          id: row.id,
          name: localized(row.name, lang),
          description: localized(row.description, lang),
          photo: row.media
            ? {
                src: publicMediaUrl(row.media.path),
                width: row.media.width ?? 1600,
                height: row.media.height ?? 1067,
                alt: localized(row.media.alt, lang),
              }
            : null,
        }))
        .filter((row) => row.name.trim());
    } catch (error) {
      return recover("places", error, () => []);
    }
  },
);
