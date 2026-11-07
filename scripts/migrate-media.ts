import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { defaultAlts, defaultPlacements } from "@/lib/cms/defaults";
import {
  readEnvFile,
  resolveTarget,
  type MigrationEnv,
} from "@/lib/cms/migrate-guard";
import { MEDIA_BUCKET, SITE_PREFIX } from "@/lib/cms/media-url";
import type { Database } from "@/lib/db/types";

// T4.19: copies the site's photos into the media bucket, with a media row each
// and placements per section in the current order. Run it with:
//   pnpm migrate:media                           (local)
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<key> pnpm migrate:media --staging=<ref>
//
// Photos are read from public/img while it exists, then from legacy/img, which
// holds the same files. When a run finishes it leaves a mark, and a later run
// stops there, so re-running cannot bring back a photo Yorgos deleted. Files
// and rows are matched by path, so --force, or a run that died half way, adds
// only what is missing and leaves a section that already has photos alone.

const CODE_ASSETS = new Set(["casa-icon-1.png"]);
const DONE_KEY = "cms_media_import";
const CACHE_SECONDS = "31536000";

const sourceRoot = existsSync("public/img/tinified")
  ? "public/img"
  : "legacy/img";

function envFile(): MigrationEnv {
  try {
    return readEnvFile(readFileSync(".env.local", "utf8"));
  } catch {
    return {};
  }
}

function photoFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return photoFiles(path);
    const isPhoto = /\.(jpe?g|png)$/i.test(entry.name);
    return isPhoto && !CODE_ASSETS.has(entry.name) ? [path] : [];
  });
}

const mimeOf = (file: string) =>
  file.endsWith(".png") ? "image/png" : "image/jpeg";

/** Keeps the file as it is unless it carries metadata that must not go public. */
async function prepare(file: string) {
  const input = readFileSync(file);
  const meta = await sharp(input).metadata();
  const { width, height } = meta.autoOrient;
  if (!meta.exif && !meta.xmp && !meta.iptc) {
    return { data: input, width, height };
  }
  const data = await sharp(input)
    .rotate()
    .toFormat(meta.format, { quality: 90 })
    .toBuffer();
  return { data, width, height };
}

async function main() {
  const args = process.argv.slice(2);
  const target = resolveTarget(args, process.env, envFile());
  if ("refusal" in target) {
    console.error(target.refusal);
    process.exit(1);
  }

  const db = createClient<Database>(target.url, target.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: mark, error: markError } = await db
    .from("settings")
    .select("key")
    .eq("key", DONE_KEY)
    .maybeSingle();
  if (markError) throw markError;
  if (mark && !args.includes("--force")) {
    console.log("Photos were already imported here. Nothing to do.");
    return;
  }

  const { data: rows, error: rowsError } = await db
    .from("media")
    .select("id, path")
    .like("path", `${SITE_PREFIX}%`);
  if (rowsError) throw rowsError;
  const stored = new Map(rows.map((row) => [row.path, row.id]));

  const alts = defaultAlts();
  let uploaded = 0;
  for (const file of photoFiles(sourceRoot).sort()) {
    const name = relative(sourceRoot, file);
    const path = `${SITE_PREFIX}${name}`;
    const { data, width, height } = await prepare(file);

    const { error: uploadError } = await db.storage
      .from(MEDIA_BUCKET)
      .upload(path, data, {
        contentType: mimeOf(file),
        cacheControl: CACHE_SECONDS,
        upsert: false,
      });
    const alreadyThere =
      uploadError && /exists|duplicate/i.test(uploadError.message);
    if (uploadError && !alreadyThere) {
      throw new Error(`${name}: ${uploadError.message}`);
    }
    if (!uploadError) uploaded += 1;

    if (!stored.has(path)) {
      const { data: row, error } = await db
        .from("media")
        .insert({
          path,
          mime_type: mimeOf(file),
          width,
          height,
          size_bytes: data.length,
          alt: alts[name] ?? {},
        })
        .select("id")
        .single();
      if (error) throw error;
      stored.set(path, row.id);
    }
  }

  let placed = 0;
  for (const [collection, paths] of Object.entries(defaultPlacements())) {
    const { count, error: countError } = await db
      .from("media_placements")
      .select("id", { count: "exact", head: true })
      .eq("collection", collection);
    if (countError) throw countError;
    if (count) continue;

    const { error } = await db.from("media_placements").insert(
      paths.map((name, index) => {
        const mediaId = stored.get(`${SITE_PREFIX}${name}`);
        if (!mediaId) throw new Error(`No photo found for ${name}`);
        return {
          collection,
          media_id: mediaId,
          sort_order: index,
          is_cover: index === 0,
        };
      }),
    );
    if (error) throw error;
    placed += paths.length;
  }

  const { error: doneError } = await db.from("settings").upsert({
    key: DONE_KEY,
    is_public: false,
    value: { finishedAt: new Date().toISOString() },
  });
  if (doneError) throw doneError;

  console.log(
    `Photo import done from ${sourceRoot}: ${uploaded} files uploaded, ${placed} placements added.`,
  );
}

main().catch((error) => {
  console.error("Photo import failed:", error.message ?? error);
  process.exit(1);
});
