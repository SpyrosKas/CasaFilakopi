import { randomUUID } from "node:crypto";
import { expect, type Page, type Request } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { db } from "./admin-helpers";

// The CMS tests work only on the test page (CMS_TEST_PAGE=1), whose slug and
// photo sections exist nowhere else, and they remove everything they add.

export const TEST_SLUG = "cms-test";
export const ROOM_COLLECTION = "section.room";
export const HERO_COLLECTION = "test.hero";
const COLLECTIONS = [ROOM_COLLECTION, HERO_COLLECTION];

export const storage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
).storage;

/** Text marker of rows this run adds to the shared list tables. */
export const LIST_MARK = "cms-e2e-row";

export interface Block {
  en: Record<string, string>;
  el: Record<string, string>;
}

/** Everything the tests can leave behind, including after a killed run. */
export async function cleanTestContent(): Promise<void> {
  const { rows } = await db.query<{ id: string; path: string }>(
    `select m.id, m.path from public.media m
     join public.media_placements p on p.media_id = m.id
     where p.collection = any($1) and m.path like 'uploads/%'`,
    [COLLECTIONS],
  );
  await db.query(
    `delete from public.media_placements where collection = any($1)`,
    [COLLECTIONS],
  );
  if (rows.length) {
    await storage.from("media").remove(rows.map((row) => row.path));
    await db.query(
      `delete from public.media m where m.id = any($1::uuid[])
       and not exists (select 1 from public.media_placements p where p.media_id = m.id)`,
      [rows.map((row) => row.id)],
    );
  }
  await db.query(`delete from public.pages where slug = $1`, [TEST_SLUG]);
  await db.query(`delete from public.faq where question::text like $1`, [
    `%${LIST_MARK}%`,
  ]);
  await db.query(`delete from public.testimonials where author like $1`, [
    `%${LIST_MARK}%`,
  ]);
  await db.query(`delete from public.places where name::text like $1`, [
    `%${LIST_MARK}%`,
  ]);
}

/** A published page, written directly, so each test starts from known text. */
export async function seedTestPage(
  blocks: Record<string, Block>,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.pages (slug, status, published_at)
     values ($1, 'published', now())
     on conflict (slug) do update set status = 'published'
     returning id`,
    [TEST_SLUG],
  );
  const order = ["hero", "room", "main", "seo"];
  for (const [key, block] of Object.entries(blocks)) {
    await db.query(
      `insert into public.content_blocks (page_id, key, draft, published, sort_order)
       values ($1, $2, $3, $3, $4)
       on conflict (page_id, key) do update
       set draft = excluded.draft, published = excluded.published`,
      [rows[0].id, key, JSON.stringify(block), order.indexOf(key)],
    );
  }
}

export const baseBlocks = (mark: string): Record<string, Block> => ({
  hero: { en: { title: `Hero ${mark}` }, el: { title: `Ήρωας ${mark}` } },
  room: {
    en: { title: `Room ${mark}`, body: `English body ${mark}` },
    el: { title: `Δωμάτιο ${mark}`, body: `Ελληνικό κείμενο ${mark}` },
  },
  main: { en: { body: "" }, el: { body: "" } },
  seo: {
    en: { metaTitle: `Meta ${mark}`, metaDescription: "" },
    el: { metaTitle: `Μέτα ${mark}`, metaDescription: "" },
  },
});

export async function publishedField(
  key: string,
  lang: string,
  field: string,
): Promise<{ draft: string | null; published: string | null }> {
  const { rows } = await db.query(
    `select b.draft -> $2 ->> $3 as draft, b.published -> $2 ->> $3 as published
     from public.content_blocks b join public.pages p on p.id = b.page_id
     where p.slug = $4 and b.key = $1`,
    [key, lang, field, TEST_SLUG],
  );
  return rows[0];
}

export async function mediaInSection(collection = ROOM_COLLECTION) {
  const { rows } = await db.query<{
    id: string;
    path: string;
    is_cover: boolean;
    alt: Record<string, string>;
  }>(
    `select m.id, m.path, m.alt, p.is_cover from public.media_placements p
     join public.media m on m.id = p.media_id
     where p.collection = $1 order by p.sort_order`,
    [collection],
  );
  return rows;
}

/** A real JPEG with camera details and a GPS position in its EXIF block. */
export async function photoWithGps(color: {
  r: number;
  g: number;
  b: number;
}): Promise<Buffer> {
  return sharp({
    create: { width: 1400, height: 1000, channels: 3, background: color },
  })
    .withExif({
      IFD0: { Make: "SecretCamera", Copyright: "Secret owner" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "36/1 44/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "24/1 30/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

export const filePayload = (name: string, buffer: Buffer) => ({
  name,
  mimeType: "image/jpeg",
  buffer,
});

export const uniqueMark = () => randomUUID().slice(0, 8);

/** Paths of the stored photos on a public page, in page order. */
export async function publicPhotos(page: Page, path: string) {
  await page.goto(path);
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>(".gallery__track img")].map(
      (image) => {
        const source = new URL(image.currentSrc || image.src);
        const original = source.searchParams.get("url") ?? source.pathname;
        return decodeURIComponent(original).split("/media/").pop()!;
      },
    ),
  );
}

export async function expectNoBrokenImages(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const images = [...document.querySelectorAll("img")];
        images.forEach((image) => (image.loading = "eager"));
        await Promise.all(
          images.map((image) => image.decode().catch(() => undefined)),
        );
        return images
          .filter((image) => !image.complete || image.naturalWidth === 0)
          .map((image) => image.src);
      }),
    )
    .toEqual([]);
}

export interface RecordedAction {
  action: string;
  contentType: string;
  body: Buffer;
  url: string;
}

/** Keeps one real request per server action the page sends. */
export function recordActions(
  page: Page,
  into: Map<string, RecordedAction>,
): void {
  page.on("request", (request: Request) => {
    const action = request.headers()["next-action"];
    if (request.method() !== "POST" || !action || into.has(action)) return;
    into.set(action, {
      action,
      contentType: request.headers()["content-type"],
      body: request.postDataBuffer() ?? Buffer.alloc(0),
      url: new URL(request.url()).pathname,
    });
  });
}
