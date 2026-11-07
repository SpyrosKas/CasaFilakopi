import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  readEnvFile,
  resolveTarget,
  type MigrationEnv,
} from "@/lib/cms/migrate-guard";
import { planPages, planReviews } from "@/lib/cms/migrate-plan";
import type { Database, Json } from "@/lib/db/types";

// T4.21: copies the site's text from the code into the database, as both draft
// and published, in English and Greek. Run it with:
//   pnpm migrate:content                         (local)
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<key> pnpm migrate:content --staging=<ref>
//
// Safe to run twice, and safe after Yorgos has started editing: it only adds
// what is missing and never changes a row that already exists.

function envFile(): MigrationEnv {
  try {
    return readEnvFile(readFileSync(".env.local", "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const target = resolveTarget(process.argv.slice(2), process.env, envFile());
  if ("refusal" in target) {
    console.error(target.refusal);
    process.exit(1);
  }

  const db = createClient<Database>(target.url, target.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let newBlocks = 0;
  for (const page of planPages()) {
    const { error: pageError } = await db.from("pages").upsert(
      {
        slug: page.slug,
        title: page.title,
        status: "published",
        published_at: new Date().toISOString(),
      },
      { onConflict: "slug", ignoreDuplicates: true },
    );
    if (pageError) throw pageError;

    const { data: row, error: readError } = await db
      .from("pages")
      .select("id")
      .eq("slug", page.slug)
      .single();
    if (readError) throw readError;

    const { data: added, error } = await db
      .from("content_blocks")
      .upsert(
        page.blocks.map((block) => ({
          page_id: row.id,
          key: block.key,
          draft: block.data as unknown as NonNullable<Json>,
          published: block.data as unknown as NonNullable<Json>,
          sort_order: block.sortOrder,
        })),
        { onConflict: "page_id,key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    newBlocks += added.length;
  }

  // A review Yorgos deleted must stay deleted, so these go into an empty table
  // only.
  const { count, error: countError } = await db
    .from("testimonials")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  let newReviews = 0;
  if (count === 0) {
    const reviews = planReviews();
    const { error } = await db.from("testimonials").upsert(
      reviews.map((review) => ({
        ...review,
        body: review.body as unknown as NonNullable<Json>,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    newReviews = reviews.length;
  }

  console.log(
    `Content import done: ${newBlocks} new sections, ${newReviews} new reviews.`,
  );
}

main().catch((error) => {
  console.error("Content import failed:", error.message ?? error);
  process.exit(1);
});
