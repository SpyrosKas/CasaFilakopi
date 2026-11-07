import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";

// What the PDF font can print. Guests type names in any script, and in practice
// that means Latin, Greek and Cyrillic. Sending anything else to the font
// library is not just unreadable: Devanagari, for one, crashes its shaping code
// (regeneratorRuntime is not defined), and a PDF that can never be made would
// leave a document stuck on "PDF missing".

export const FONT_REGULAR = "NotoSans-Regular.ttf";
export const FONT_BOLD = "NotoSans-Bold.ttf";

/** Printed for a character the font does not have. */
export const REPLACEMENT = "?";

/** Far longer than any real field. Keeps one odd value from filling pages. */
const MAX_LENGTH = 2000;

const files = new Map<string, Uint8Array>();
let characters: Set<number> | null = null;

export function fontFile(name: string): Uint8Array {
  const known = files.get(name);
  if (known) return known;
  const bytes = readFileSync(
    path.join(process.cwd(), "lib", "invoicing", "fonts", name),
  );
  files.set(name, bytes);
  return bytes;
}

interface LoadedFont {
  characterSet: number[];
  layout(text: string): unknown;
}

function canShape(font: LoadedFont, code: number): boolean {
  try {
    font.layout(String.fromCodePoint(code));
    return true;
  } catch {
    return false;
  }
}

/**
 * What both weights hold and the library can shape. Being in the font is not
 * enough: Noto Sans holds Devanagari, and shaping it is what crashes. The test
 * uses each character alone, because the library picks its shaper from the
 * text, so a Latin letter in front would hide the failure.
 */
function printableCharacters(): Set<number> {
  if (characters) return characters;
  const [regular, bold] = [FONT_REGULAR, FONT_BOLD].map(
    (name) => fontkit.create(fontFile(name)) as unknown as LoadedFont,
  );
  const inBold = new Set(bold.characterSet);
  characters = new Set(
    regular.characterSet.filter(
      (code) => inBold.has(code) && canShape(regular, code),
    ),
  );
  return characters;
}

/** Joiners and direction marks print as nothing, so they are simply dropped. */
const isInvisible = (char: string) => /\p{Cf}/u.test(char);
const isControl = (char: string) => /\p{Cc}/u.test(char);

/** Latin, Greek, Cyrillic and the euro sign. The last resort below. */
function isPlainScript(char: string): boolean {
  const code = char.codePointAt(0)!;
  return (
    (code >= 0x20 && code <= 0x24f) ||
    (code >= 0x370 && code <= 0x52f) ||
    code === 0x20ac
  );
}

/** The characters in this text the PDF cannot show, each listed once. */
export function cannotPrint(text: string): string[] {
  const known = printableCharacters();
  const missing = new Set<string>();
  for (const char of text.normalize("NFC")) {
    if (isControl(char) || isInvisible(char)) continue;
    if (!known.has(char.codePointAt(0)!)) missing.add(char);
  }
  return [...missing];
}

/** The same text, with only characters the font has. */
export function printable(text: string): string {
  const known = printableCharacters();
  let result = "";
  for (const char of text.normalize("NFC").slice(0, MAX_LENGTH)) {
    if (isControl(char)) result += " ";
    else if (isInvisible(char)) continue;
    else result += known.has(char.codePointAt(0)!) ? char : REPLACEMENT;
  }
  return result;
}

/** For the rare string the font holds but its shaping code still refuses. */
export function plainOnly(text: string): string {
  let result = "";
  for (const char of text) result += isPlainScript(char) ? char : REPLACEMENT;
  return result;
}
