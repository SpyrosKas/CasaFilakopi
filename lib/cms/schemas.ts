import { z } from "zod";
import { findCollection, findPage } from "@/lib/cms/registry";
import { safeHref, sanitizeLine, sanitizeText } from "@/lib/cms/rich";
import { reviewBodySchema } from "@/lib/cms/stored";
import { t } from "@/lib/cms/strings";
import type {
  BlockData,
  FieldDef,
  FieldValues,
  Lang,
  ListItem,
  SectionDef,
} from "@/lib/cms/types";
import { isItemId } from "@/lib/cms/registry";

// Checks on everything the editor sends. The form is never trusted: only fields
// in the registry survive, and all text is cleaned here on the server.

const MAX_LENGTH = {
  line: 300,
  text: 1000,
  rich: 60000,
  email: 254,
  url: 500,
} as const;

const MAX_ITEMS = 80;

export const slugSchema = z
  .string()
  .max(40)
  .refine((slug) => Boolean(findPage(slug)));

export const collectionSchema = z
  .string()
  .max(80)
  .refine((id) => Boolean(findCollection(id)));

const inputValues = z.record(z.string().max(40), z.string().max(70000));

const inputItem = z.object({
  id: z.string().refine(isItemId),
  choice: z.string().max(40).optional(),
  en: inputValues,
  el: inputValues,
});

const inputBlock = z.object({
  en: inputValues.default({}),
  el: inputValues.default({}),
  shared: inputValues.optional(),
  items: z.array(inputItem).max(MAX_ITEMS).optional(),
});

export const saveDraftSchema = z.object({
  slug: slugSchema,
  blocks: z.record(z.string().max(40), inputBlock),
  /** The updated_at each block was loaded with. New blocks have none. */
  versions: z.record(z.string().max(40), z.string().max(40)).default({}),
});

export const publishSchema = z.object({
  slug: slugSchema,
  confirmedEmpty: z.boolean().default(false),
});

export const discardSchema = z.object({ slug: slugSchema });

class FieldError extends Error {}

function cleanValue(field: FieldDef, raw: string | undefined): string {
  const value =
    field.kind === "rich" || field.kind === "text"
      ? sanitizeText(raw ?? "")
      : sanitizeLine(raw ?? "").trim();
  if (value.length > MAX_LENGTH[field.kind]) {
    throw new FieldError(t.common.tooLong(field.label));
  }
  if (
    field.kind === "url" &&
    value &&
    !/^https?:\/\//i.test(safeHref(value) ?? "")
  ) {
    throw new FieldError(t.common.notValid(field.label));
  }
  if (field.kind === "email" && value && !z.email().safeParse(value).success) {
    throw new FieldError(t.common.notValid(field.label));
  }
  return value;
}

function cleanValues(
  fields: FieldDef[],
  input: FieldValues | undefined,
): FieldValues {
  return Object.fromEntries(
    fields.map((field) => [field.name, cleanValue(field, input?.[field.name])]),
  );
}

function cleanItems(section: SectionDef, items: ListItem[]): ListItem[] {
  const list = section.list!;
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new FieldError(t.common.somethingWrong);
  const choices = list.choice.options.map((option) => option.value);
  return items.map((item) => ({
    id: item.id,
    choice: choices.includes(item.choice ?? "") ? item.choice : choices[0],
    en: cleanValues(list.fields, item.en),
    el: cleanValues(list.fields, item.el),
  }));
}

/** Keeps what this section allows, cleaned, or names the field that failed. */
export function cleanBlock(
  section: SectionDef,
  input: z.infer<typeof inputBlock>,
): { data: BlockData } | { error: string } {
  const perLanguage = section.fields.filter((field) => !field.shared);
  const shared = section.fields.filter((field) => field.shared);
  try {
    const data: BlockData = {
      en: cleanValues(perLanguage, input.en),
      el: cleanValues(perLanguage, input.el),
    };
    if (shared.length) data.shared = cleanValues(shared, input.shared);
    if (section.list) data.items = cleanItems(section, input.items ?? []);
    return { data };
  } catch (error) {
    if (error instanceof FieldError) return { error: error.message };
    throw error;
  }
}

export const startUploadSchema = z.object({
  collection: collectionSchema,
  size: z.number().int().positive().max(15_728_640),
});

export const finishUploadSchema = z.object({
  collection: collectionSchema,
  tempPath: z.string().regex(/^cms\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
  replaceMediaId: z.uuid().optional(),
});

export const reorderSchema = z.object({
  collection: collectionSchema,
  ids: z.array(z.uuid()).min(1).max(200),
});

export const altSchema = z.object({
  collection: collectionSchema,
  mediaId: z.uuid(),
  en: z
    .string()
    .max(300)
    .transform((value) => sanitizeLine(value).trim()),
  el: z
    .string()
    .max(300)
    .transform((value) => sanitizeLine(value).trim()),
});

export const placementSchema = z.object({
  collection: collectionSchema,
  mediaId: z.uuid(),
});

export const deleteSchema = z.object({ mediaId: z.uuid() });

const line = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => sanitizeLine(value).trim());
const body = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => sanitizeText(value).trim());

const perLang = <T extends z.ZodType>(schema: T) =>
  z.object({ en: schema, el: schema });

export const listKindSchema = z.enum(["faq", "testimonials", "places"]);
export type ListKind = z.infer<typeof listKindSchema>;

const hasOne = (value: Record<Lang, string>) => Boolean(value.en || value.el);

const required = { error: t.lists.required };

export const faqEntrySchema = z.object({
  kind: z.literal("faq"),
  id: z.uuid().optional(),
  question: perLang(line(300)).refine(hasOne, required),
  answer: perLang(body(5000)).refine(hasOne, required),
});

export const testimonialEntrySchema = z.object({
  kind: z.literal("testimonials"),
  id: z.uuid().optional(),
  author: line(120).refine(Boolean, required),
  text: perLang(body(5000)).refine(hasOne, required),
  teaser: perLang(body(600)),
  stars: reviewBodySchema.shape.stars,
});

export const placeEntrySchema = z.object({
  kind: z.literal("places"),
  id: z.uuid().optional(),
  name: perLang(line(200)).refine(hasOne, required),
  description: perLang(body(3000)),
  mediaId: z.uuid().nullable(),
});

export const listEntrySchema = z.discriminatedUnion("kind", [
  faqEntrySchema,
  testimonialEntrySchema,
  placeEntrySchema,
]);

export const listStatusSchema = z.object({
  kind: listKindSchema,
  id: z.uuid(),
  status: z.enum(["draft", "published"]),
});

export const listDeleteSchema = z.object({
  kind: listKindSchema,
  id: z.uuid(),
});

export const listReorderSchema = z.object({
  kind: listKindSchema,
  ids: z.array(z.uuid()).min(1).max(200),
});
