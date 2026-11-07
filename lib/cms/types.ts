// The shape of editable content. Pure types: safe in the browser and in scripts.

export const LANGS = ["el", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_NAMES: Record<Lang, string> = {
  el: "Greek",
  en: "English",
};

export type FieldValues = Record<string, string>;

/** One row of a real list, such as an amenity or a directions step. */
export interface ListItem {
  /** Stable across reordering. Also names a step's photo collection. */
  id: string;
  /** The icon, stored as a value and never worked out from the text. */
  choice?: string;
  en: FieldValues;
  el: FieldValues;
}

/** What content_blocks.draft and content_blocks.published hold. */
export interface BlockData {
  en: FieldValues;
  el: FieldValues;
  /** Values with no language, such as an email address. */
  shared?: FieldValues;
  items?: ListItem[];
}

export type FieldKind = "line" | "text" | "rich" | "email" | "url";

export interface FieldDef {
  name: string;
  /** Shown after the section name: "Kitchen: description". */
  label: string;
  kind: FieldKind;
  hint?: string;
  /** One value for both languages. */
  shared?: boolean;
  /** Never borrows the other language: an empty field stays empty. */
  strict?: boolean;
}

export interface ChoiceDef {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface ListDef {
  itemLabel: string;
  addLabel: string;
  fields: FieldDef[];
  choice: ChoiceDef;
  /** Each item has a photo of its own, in the collection step.<id>. */
  itemPhotos?: boolean;
  /** Prefix of the id given to a new item. */
  idPrefix: string;
}

export interface SectionDef {
  key: string;
  label: string;
  fields: FieldDef[];
  list?: ListDef;
  /** The photo collection of this section, if it has one. */
  photos?: string;
  /** Where the words of this section are really edited. */
  link?: { href: string; label: string };
}

export interface PageDef {
  slug: string;
  label: string;
  /** Path after the locale. Empty for Home, null for the shared parts. */
  path: string | null;
  sections: SectionDef[];
  /** Other pages that show this page's content. */
  alsoShownOn?: string[];
}

export interface CollectionDef {
  id: string;
  label: string;
  group: string;
  /** Holds exactly one photo. */
  single?: boolean;
  /** May be left with no photo at all. */
  optional?: boolean;
  /** Decoration only, so it needs no description. */
  decorative?: boolean;
  /** Slugs of the pages that show this collection. */
  pages: string[];
  /** The page and section whose text sits beside these photos. */
  textOn?: string;
}

/** What a public page gets for one photo. */
export interface SitePhoto {
  src: string;
  width: number;
  height: number;
  alt: string;
}
