import { t } from "@/lib/cms/strings";
import {
  LANGS,
  type BlockData,
  type FieldDef,
  type FieldValues,
  type Lang,
  type PageDef,
} from "@/lib/cms/types";

const filled = (values: FieldValues | undefined, field: FieldDef) =>
  Boolean(values?.[field.name]?.trim());

/** The language left empty when the other one has text, or null. */
export function emptyLanguage(
  values: Record<Lang, FieldValues | undefined>,
  field: FieldDef,
): Lang | null {
  if (field.shared) return null;
  const empty = LANGS.filter((lang) => !filled(values[lang], field));
  return empty.length === 1 ? empty[0] : null;
}

/** "Kitchen: title (Greek is empty)", for the warning before publishing. */
export function findEmptyLanguages(
  page: PageDef,
  blocks: Record<string, BlockData | undefined>,
): string[] {
  const found: string[] = [];
  for (const section of page.sections) {
    const block = blocks[section.key];
    if (!block) continue;
    const add = (label: string, lang: Lang) =>
      found.push(`${label} (${t.editor.missing(t.languages[lang])})`);

    for (const field of section.fields) {
      const lang = emptyLanguage(block, field);
      if (lang) add(`${section.label}: ${field.label}`, lang);
    }
    block.items?.forEach((item, index) => {
      for (const field of section.list?.fields ?? []) {
        const lang = emptyLanguage(item, field);
        if (lang) {
          const name = t.editor.itemHeading(section.list!.itemLabel, index + 1);
          add(`${section.label}: ${name}: ${field.label}`, lang);
        }
      }
    });
  }
  return found;
}
