import { z } from "zod";

// What the jsonb columns are allowed to hold when read back.

const values = z.record(z.string(), z.string());

export const listItemSchema = z.object({
  id: z.string(),
  choice: z.string().optional(),
  en: values,
  el: values,
});

export const blockDataSchema = z.object({
  en: values.default({}),
  el: values.default({}),
  shared: values.optional(),
  items: z.array(listItemSchema).optional(),
});

/**
 * testimonials has one jsonb column for the words. The full text per language
 * sits at en and el, like every other translated column, and the short version
 * and stars sit beside them.
 */
export const reviewBodySchema = z.object({
  en: z.string().default(""),
  el: z.string().default(""),
  teaser: z
    .object({ en: z.string().default(""), el: z.string().default("") })
    .default({ en: "", el: "" }),
  stars: z.number().min(0.5).max(5).default(5),
});

export type ReviewBody = z.infer<typeof reviewBodySchema>;
