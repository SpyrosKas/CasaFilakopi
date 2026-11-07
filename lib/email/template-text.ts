import type {
  EmailTemplateDef,
  TemplateCopy,
  TemplateVariables,
} from "@/emails/types";

// The text Yorgos edits (EML-06). Deliberately small, so he cannot break an
// email and a guest's words can never become markup:
//
//   {{name}}             a value, always escaped
//   [Label]({{someLink}}) alone on a line, a button. Only a value whose name
//                         ends in Link can sit behind one, so a guest's name
//                         or message can never become a link in an email.
//   ## Heading           alone on a line, a heading
//   - item               a list
//
// A blank line starts a new paragraph. A line that uses a value the email does
// not have is left out, which is how optional details work with no "if" syntax.
//
// The text is parsed before any value goes in, so a guest typing {{secret}} or
// <script> in a message stays literal text.

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;
const BUTTON =
  /^\[([^\]\n]+)\]\(\s*(\{\{\s*[A-Za-z][A-Za-z0-9]*Link\s*\}\})\s*\)$/;
const BUTTON_SHAPED = /^\[[^\]\n]+\]\(.*\)$/;

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 10_000;

type Token = { text: string } | { name: string };

export type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "heading"; text: string }
  | { kind: "button"; label: string; href: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of source.matchAll(PLACEHOLDER)) {
    if (match.index > last) {
      tokens.push({ text: source.slice(last, match.index) });
    }
    tokens.push({ name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < source.length) tokens.push({ text: source.slice(last) });
  return tokens;
}

export const placeholdersIn = (source: string): string[] => [
  ...new Set([...source.matchAll(PLACEHOLDER)].map((match) => match[1])),
];

/** Every problem with some text. Empty means it can be saved. */
export function validateText(
  copy: TemplateCopy,
  allowed: readonly string[],
  required: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const whole = `${copy.subject}\n${copy.body}`;

  if (!copy.subject.trim()) problems.push("empty_subject");
  if (!copy.body.trim()) problems.push("empty_body");
  if (/[\r\n]/.test(copy.subject)) problems.push("subject_line_break");
  if (copy.subject.length > MAX_SUBJECT_LENGTH) {
    problems.push("subject_too_long");
  }
  if (copy.body.length > MAX_BODY_LENGTH) problems.push("body_too_long");

  // Whatever the pattern did not take as a placeholder is a typo.
  if (/\{\{|\}\}/.test(whole.replace(PLACEHOLDER, ""))) {
    problems.push("broken_braces");
  }
  const badButton = copy.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => BUTTON_SHAPED.test(line) && !BUTTON.test(line));
  if (badButton) problems.push("bad_button");

  const used = placeholdersIn(whole);
  for (const name of used) {
    if (!allowed.includes(name)) problems.push(`unknown:${name}`);
  }
  for (const name of required) {
    if (!used.includes(name)) problems.push(`missing:${name}`);
  }
  return problems;
}

export const validateCopy = (def: EmailTemplateDef, copy: TemplateCopy) =>
  validateText(copy, def.placeholders, def.required);

export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list.length) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };

  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const button = BUTTON.exec(line);
    if (!line) {
      flush();
    } else if (button) {
      flush();
      blocks.push({ kind: "button", label: button[1], href: button[2] });
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
    } else if (line.startsWith("- ")) {
      if (paragraph.length) flush();
      list.push(line.slice(2).trim());
    } else {
      if (list.length) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const hasValue = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Null when the line needs a value the email does not have. */
function fill(
  source: string,
  values: TemplateVariables,
  encode: (text: string) => string,
): string | null {
  let out = "";
  for (const token of tokenize(source)) {
    if ("text" in token) {
      out += encode(token.text);
      continue;
    }
    const value = values[token.name];
    if (!hasValue(value)) return null;
    out += encode(value);
  }
  return out;
}

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Escapes, and keeps a guest's own line breaks. */
const escapeHtmlLines = (value: string) =>
  escapeHtml(value).replace(/\r\n?|\n/g, "<br>");

const plain = (value: string) => value;

/** Only web links can sit behind a button. */
function safeHref(href: string): string | null {
  try {
    const { protocol } = new URL(href);
    return protocol === "https:" || protocol === "http:" ? href : null;
  } catch {
    return null;
  }
}

export interface FilledBlock {
  kind: Block["kind"];
  /** Escaped, ready for HTML. */
  html: string[];
  /** Unescaped, ready for the plain-text part. */
  text: string[];
  /** Buttons only. */
  href?: string;
}

/** Puts the values in. Blocks that end up empty are dropped. */
export function fillBlocks(
  blocks: Block[],
  values: TemplateVariables,
): FilledBlock[] {
  const lines = (sources: string[]) => ({
    html: sources
      .map((source) => fill(source, values, escapeHtmlLines))
      .filter((line) => line !== null),
    text: sources
      .map((source) => fill(source, values, plain))
      .filter((line) => line !== null),
  });

  const filled: FilledBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "button") {
      const href = fill(block.href, values, plain);
      const label = lines([block.label]);
      const target = href && safeHref(href);
      if (target && label.html.length) {
        filled.push({ kind: "button", ...label, href: target });
      }
      continue;
    }
    const sources =
      block.kind === "paragraph"
        ? block.lines
        : block.kind === "list"
          ? block.items
          : [block.text];
    const content = lines(sources);
    if (content.html.length) filled.push({ kind: block.kind, ...content });
  }
  return filled;
}

/** A value in a subject can never start a new header line. */
export const headerSafe = (value: string) =>
  value
    .replace(/[\r\n\t\0]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

/** A subject never loses a whole line, so a missing value just goes empty. */
export function fillSubject(
  subject: string,
  values: TemplateVariables,
): string {
  const text = tokenize(subject)
    .map((token) => ("text" in token ? token.text : (values[token.name] ?? "")))
    .join("");
  return headerSafe(text).slice(0, MAX_SUBJECT_LENGTH);
}
