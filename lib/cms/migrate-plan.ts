import { createHash } from "node:crypto";
import { defaultBlocks, defaultReviews } from "@/lib/cms/defaults";
import { i18nFor } from "@/lib/admin/i18n";
import { allPages } from "@/lib/cms/registry";
import type { ReviewBody } from "@/lib/cms/stored";
import type { BlockData } from "@/lib/cms/types";

// What the content import writes. Kept apart from the script so it can be read
// and tested without a database.

export interface PlannedBlock {
  key: string;
  sortOrder: number;
  data: BlockData;
}

export interface PlannedPage {
  slug: string;
  title: { en: string; el: string };
  blocks: PlannedBlock[];
}

const EMPTY: BlockData = { en: {}, el: {} };

/** Every page, with a block per section in the order the page shows them. */
export function planPages(): PlannedPage[] {
  const defaults = defaultBlocks();
  return allPages()
    .filter((page) => page.slug in defaults)
    .map((page) => {
      const blocks = defaults[page.slug];
      return {
        slug: page.slug,
        title: {
          en: blocks.hero?.en.title ?? i18nFor("en").say(page.label),
          el: blocks.hero?.el.title ?? i18nFor("el").say(page.label),
        },
        blocks: page.sections
          .filter((section) => section.fields.length > 0 || section.list)
          .map((section, index) => ({
            key: section.key,
            sortOrder: index,
            data: blocks[section.key] ?? EMPTY,
          })),
      };
    });
}

/** The same id on every run, so a second import finds the first one's rows. */
export function stableId(name: string): string {
  const hex = createHash("sha256")
    .update(`casa-filakopi:${name}`)
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function planReviews() {
  return defaultReviews().map((review, index) => {
    const body: ReviewBody = {
      en: review.en.text,
      el: review.el.text,
      teaser: { en: review.en.teaser, el: review.el.teaser },
      stars: review.stars,
    };
    return {
      id: stableId(`review:${review.key}`),
      author: review.author,
      body,
      status: "published" as const,
      sort_order: index,
    };
  });
}
