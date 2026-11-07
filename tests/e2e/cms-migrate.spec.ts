import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { db } from "./admin-helpers";
import { skipCookieBanner } from "./helpers";

// The two import scripts, run for real against local Supabase.

const IMPORT_LOCK = "cms-import-e2e";

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("pnpm", ["--silent", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

async function counts() {
  const { rows } = await db.query(`
    select
      (select count(*)::int from public.pages) as pages,
      (select count(*)::int from public.content_blocks) as blocks,
      (select count(*)::int from public.testimonials) as reviews,
      (select count(*)::int from public.media where path like 'site/%') as media,
      (select count(*)::int from public.media_placements p
         join public.media m on m.id = p.media_id
         where m.path like 'site/%') as placements`);
  return rows[0];
}

test.describe.configure({ mode: "serial" });

test("both imports change nothing when run twice", async () => {
  test.setTimeout(180_000);
  const lock = await db.connect();
  await lock.query(`select pg_advisory_lock(hashtext($1))`, [IMPORT_LOCK]);
  try {
    const before = await counts();
    expect(before.media).toBeGreaterThanOrEqual(66);

    const content = run(["migrate:content"]);
    expect(content.status, content.stderr).toBe(0);
    expect(content.stdout).toContain("0 new sections");

    const again = run(["migrate:media"]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("already imported");

    // Past the finished mark, so the matching by path is what gets tested.
    const forced = run(["migrate:media", "--force"]);
    expect(forced.status, forced.stderr).toBe(0);
    expect(forced.stdout).toContain("0 files uploaded, 0 placements added");

    expect(await counts()).toEqual(before);
  } finally {
    await lock.query(`select pg_advisory_unlock(hashtext($1))`, [IMPORT_LOCK]);
    lock.release();
  }
});

test("an import keeps what Yorgos changed", async () => {
  const { rows } = await db.query(`
    select b.id, b.draft from public.content_blocks b
    join public.pages p on p.id = b.page_id
    where p.slug = 'book' and b.key = 'main'`);
  const edited = { ...rows[0].draft, en: { soon: "Edited", body: "Edited" } };
  await db.query(`update public.content_blocks set draft = $1 where id = $2`, [
    JSON.stringify(edited),
    rows[0].id,
  ]);
  try {
    expect(run(["migrate:content"]).status).toBe(0);
    const after = await db.query(
      `select draft -> 'en' ->> 'soon' as soon from public.content_blocks where id = $1`,
      [rows[0].id],
    );
    expect(after.rows[0].soon).toBe("Edited");
  } finally {
    await db.query(
      `update public.content_blocks set draft = $1 where id = $2`,
      [JSON.stringify(rows[0].draft), rows[0].id],
    );
  }
});

for (const script of ["migrate:content", "migrate:media"]) {
  test(`${script} refuses production and unnamed hosts`, () => {
    const hosted = {
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      SUPABASE_SECRET_KEY: "not-a-real-key",
    };
    const unnamed = run([script], hosted);
    expect(unnamed.status).toBe(1);
    expect(unnamed.stderr).toContain("Refusing to run");

    const wrongRef = run([script, "--staging=abcdefghijklmnop"], hosted);
    expect(wrongRef.status).toBe(1);

    const production = run([script], {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      VERCEL_ENV: "production",
    });
    expect(production.status).toBe(1);
    expect(production.stderr).toContain("production");
  });
}

test("no public page points at public/img any more", async ({ page }) => {
  await skipCookieBanner(page);
  for (const path of ["/en", "/el/host", "/en/directions", "/en/gallery"]) {
    await page.goto(path);
    const local = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .map((image) => image.getAttribute("src") ?? "")
        .filter((src) => decodeURIComponent(src).includes("/img/")),
    );
    expect(local, path).toEqual([]);
    expect(await page.locator("#main img").count()).toBeGreaterThan(0);
  }
});

test("amenity icons follow the list, not the wording", async ({ page }) => {
  await skipCookieBanner(page);
  await page.goto("/el");
  await expect(page.locator(".amenities li")).toHaveCount(10);
  await expect(page.locator(".amenities li svg")).toHaveCount(10);
});
