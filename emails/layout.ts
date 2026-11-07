import { escapeHtml, type FilledBlock } from "@/lib/email/template-text";
import type { EmailLocale } from "./types";

// The branded frame. Colours are the site's tokens from styles/site.css, spelt
// out because mail clients do not read custom properties. Tables and inline
// styles because Outlook and Gmail ignore most else. The name is set in text,
// not an image, so nothing loads from a server when an email is opened.

const color = {
  page: "#f1ebe0", // --sand
  card: "#fbfaf6", // --lime
  line: "#d8cfbf", // --line
  ink: "#1f2a33", // --ink
  soft: "#4d5862", // --ink-soft
  aegean: "#024c8e", // --aegean
  onDark: "#ffffff", // --on-dark
};

const SERIF = `'Noto Serif Display',Georgia,'Times New Roman',serif`;
const SANS = `Commissioner,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

function blockHtml(block: FilledBlock): string {
  switch (block.kind) {
    case "heading":
      return `<h2 style="margin:24px 0 8px;font-family:${SERIF};font-size:20px;line-height:1.3;font-weight:500;color:${color.ink}">${block.html.join(" ")}</h2>`;
    case "list":
      return `<ul style="margin:0 0 16px;padding:0 0 0 20px;font-family:${SANS};font-size:16px;line-height:1.6;color:${color.ink}">${block.html
        .map((item) => `<li style="margin:0 0 4px">${item}</li>`)
        .join("")}</ul>`;
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:4px;background:${color.aegean}"><a href="${escapeHtml(block.href!)}" style="display:inline-block;padding:14px 24px;font-family:${SANS};font-size:16px;line-height:1.2;font-weight:600;color:${color.onDark};text-decoration:none;border-radius:4px">${block.html.join(" ")}</a></td></tr></table>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${color.ink}">${block.html.join("<br>")}</p>`;
  }
}

export interface LayoutOptions {
  locale: EmailLocale;
  subject: string;
  /** Unescaped. Shown only in the inbox list. */
  preheader: string;
  /** Unescaped. */
  brandName: string;
  /** Unescaped lines under the card. */
  footer: string[];
  blocks: FilledBlock[];
}

export function renderLayout(options: LayoutOptions): string {
  const { locale, subject, preheader, brandName, footer, blocks } = options;
  const footerHtml = footer
    .map(
      (line) =>
        `<p style="margin:0 0 4px;font-family:${SANS};font-size:13px;line-height:1.5;color:${color.soft}">${escapeHtml(line)}</p>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
@media (max-width: 480px) {
  .card-cell { padding: 24px 16px !important; }
  .outer-cell { padding: 16px 8px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${color.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color.page}">
<tr><td class="outer-cell" align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">
<tr><td style="padding:0 8px 16px;font-family:${SERIF};font-size:26px;line-height:1.2;font-weight:500;letter-spacing:0.01em;color:${color.aegean}">${escapeHtml(brandName)}</td></tr>
<tr><td class="card-cell" style="padding:32px;background:${color.card};border:1px solid ${color.line};border-radius:4px;word-break:break-word">
${blocks.map(blockHtml).join("\n")}
</td></tr>
<tr><td style="padding:16px 8px 0">${footerHtml}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
