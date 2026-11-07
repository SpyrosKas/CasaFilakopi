import { renderLayout } from "@/emails/layout";
import type {
  EmailLocale,
  EmailTemplateDef,
  RenderedEmail,
  TemplateCopy,
  TemplateVariables,
} from "@/emails/types";
import {
  fillBlocks,
  fillSubject,
  parseBody,
  validateCopy,
} from "./template-text";

export interface RenderOptions {
  locale: EmailLocale;
  values: TemplateVariables;
  brandName: string;
  footer: string[];
}

/** Renders text that needs no template record, such as a scheduled message. */
export function renderCopy(
  copy: TemplateCopy,
  options: RenderOptions,
): RenderedEmail {
  const { locale, values, brandName, footer } = options;
  const subject = fillSubject(copy.subject, values);
  const blocks = fillBlocks(parseBody(copy.body), values);

  const html = renderLayout({
    locale,
    subject,
    preheader:
      blocks.find((block) => block.kind === "paragraph")?.text[0] ?? "",
    brandName,
    footer,
    blocks,
  });

  const text = [
    ...blocks.map((block) => {
      if (block.kind === "button") return `${block.text[0]}: ${block.href}`;
      if (block.kind === "list") {
        return block.text.map((item) => `- ${item}`).join("\n");
      }
      if (block.kind === "heading") return block.text[0].toUpperCase();
      return block.text.join("\n");
    }),
    ["--", brandName, ...footer].join("\n"),
  ].join("\n\n");

  return { subject, html, text };
}

/**
 * Text saved in Admin was valid when saved, but an update can retire a
 * placeholder. The email then uses the built-in text, never a broken one.
 */
export function chooseCopy(
  def: EmailTemplateDef,
  locale: EmailLocale,
  override: TemplateCopy | null | undefined,
): TemplateCopy {
  if (!override) return def.copy[locale];
  const problems = validateCopy(def, override);
  if (problems.length === 0) return override;
  console.warn(
    `email template ${def.key}/${locale} override ignored: ${problems.join(", ")}`,
  );
  return def.copy[locale];
}

export function renderEmail(
  def: EmailTemplateDef,
  options: RenderOptions & { override?: TemplateCopy | null },
): RenderedEmail {
  return renderCopy(chooseCopy(def, options.locale, options.override), options);
}
