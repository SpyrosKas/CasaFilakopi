// The small formatting language of the editor. Text is stored as plain text
// with **bold**, *italic* and [words](address), and turned into React elements
// on the page. No HTML is ever stored or rendered, so a form cannot put markup
// on a public page.

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "break" };

const TAG = /<\/?[a-zA-Z!?][^>]*>/g;
// Everything below space except tab and newline, and the delete character.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** What every saved text goes through on the server. */
export function sanitizeText(value: string): string {
  let text = value.replace(/\r\n?/g, "\n").replace(CONTROL, "");
  // Removing a tag can join the pieces of another, so repeat until none are left.
  for (let last = ""; last !== text;) {
    last = text;
    text = text.replace(TAG, "");
  }
  return text;
}

/** For one-line fields, which must not hold a line break. */
export const sanitizeLine = (value: string) =>
  sanitizeText(value).replace(/\s*\n\s*/g, " ");

/** Web, email and phone links, and links inside this site. */
export function safeHref(href: string): string | null {
  const value = href.trim();
  if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(value)) return value;
  if (/^\/(?![/\\])\S*$/.test(value)) return value;
  return null;
}

const INLINE =
  /\*\*([^\n]+?)\*\*|\*([^\s*](?:[^\n*]*[^\s*])?)\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;

function parseLine(text: string): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push({ type: "text", value: rest });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: "text", value: rest.slice(0, match.index) });
    }
    const [whole, bold, italic, words, address] = match;
    if (bold !== undefined) {
      nodes.push({ type: "bold", children: parseLine(bold) });
    } else if (italic !== undefined) {
      nodes.push({ type: "italic", children: parseLine(italic) });
    } else {
      const href = safeHref(address);
      nodes.push(
        href
          ? { type: "link", href, children: parseLine(words) }
          : { type: "text", value: words },
      );
    }
    rest = rest.slice(match.index + whole.length);
  }
  return nodes;
}

/** Paragraphs split on a blank line; a single newline is a line break. */
export function parseRich(text: string): Inline[][] {
  return text
    .trim()
    .split(/\n[ \t]*\n+/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .flatMap<Inline>((row, index) =>
          index === 0 ? parseLine(row) : [{ type: "break" }, ...parseLine(row)],
        ),
    )
    .filter((paragraph) => paragraph.length > 0);
}

/** Turns the markup used in messages/*.json into the editor's language. */
export function fromMessage(message: string): string {
  return message
    .replace(/<br><\/br>/g, "\n")
    .replace(/<em>(.*?)<\/em>/g, "*$1*")
    .trimEnd();
}
