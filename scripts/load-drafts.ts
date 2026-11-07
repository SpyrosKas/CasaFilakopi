import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  readEnvFile,
  resolveTarget,
  type MigrationEnv,
} from "@/lib/cms/migrate-guard";
import type { Database, Json } from "@/lib/db/types";

// D26: loads the FAQ, house rules and legal drafts as unpublished text for
// review. Never writes `published`, and never overwrites text someone already
// entered. Run after migrate:content, with the same arguments:
//   pnpm load:drafts
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<key> pnpm load:drafts --staging=<ref>

const PAGES: Record<string, string> = {
  "house-rules": "house-rules.json",
  privacy: "privacy.json",
  terms: "terms.json",
  cancellation: "cancellation.json",
  cookies: "cookies.json",
};

const readJson = (name: string) =>
  JSON.parse(readFileSync(`content/drafts/${name}`, "utf8"));

function envFile(): MigrationEnv {
  try {
    return readEnvFile(readFileSync(".env.local", "utf8"));
  } catch {
    return {};
  }
}

const hasText = (draft: unknown) =>
  Object.values((draft ?? {}) as Record<string, { body?: string }>).some(
    (locale) => Boolean(locale?.body?.trim()),
  );

async function main() {
  const target = resolveTarget(process.argv.slice(2), process.env, envFile());
  if ("refusal" in target) {
    console.error(target.refusal);
    process.exit(1);
  }
  const db = createClient<Database>(target.url, target.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let loaded = 0;
  for (const [slug, file] of Object.entries(PAGES)) {
    const { data: page, error } = await db
      .from("pages")
      .select("id")
      .eq("slug", slug)
      .single();
    if (error) throw new Error(`Page ${slug}: run migrate:content first`);

    const { data: block, error: blockError } = await db
      .from("content_blocks")
      .select("id, draft")
      .eq("page_id", page.id)
      .eq("key", "main")
      .maybeSingle();
    if (blockError) throw blockError;

    const draft = readJson(file) as NonNullable<Json>;
    if (!block) {
      const { error: insertError } = await db
        .from("content_blocks")
        .insert({ page_id: page.id, key: "main", draft });
      if (insertError) throw insertError;
      loaded += 1;
    } else if (!hasText(block.draft)) {
      const { error: updateError } = await db
        .from("content_blocks")
        .update({ draft })
        .eq("id", block.id);
      if (updateError) throw updateError;
      loaded += 1;
    }
  }

  const { count } = await db
    .from("faq")
    .select("id", { count: "exact", head: true });
  let faq = 0;
  if (!count) {
    const entries = readJson("faq.json") as {
      question: NonNullable<Json>;
      answer: NonNullable<Json>;
    }[];
    const { error } = await db.from("faq").insert(
      entries.map((entry, index) => ({
        question: entry.question,
        answer: entry.answer,
        status: "draft" as const,
        sort_order: index,
      })),
    );
    if (error) throw error;
    faq = entries.length;
  }

  console.log(
    `Drafts loaded: ${loaded} pages, ${faq} questions. Nothing published.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
