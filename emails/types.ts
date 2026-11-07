export type EmailLocale = "en" | "el";

export const EMAIL_LOCALES: readonly EmailLocale[] = ["en", "el"];

export interface TemplateCopy {
  subject: string;
  body: string;
}

/**
 * One email. The text is plain and editable from Admin (EML-06), so it uses
 * the small syntax in lib/email/template-text.ts rather than React.
 */
export interface EmailTemplateDef {
  key: string;
  audience: "guest" | "host";
  /** What Yorgos sees in the list. */
  label: string;
  /** Every name the text may use. Anything else is refused. */
  placeholders: readonly string[];
  /** Names the text must keep, because the email is pointless without them. */
  required: readonly string[];
  copy: Record<EmailLocale, TemplateCopy>;
  /** Values for the preview and the tests. Nothing real. */
  sample: Record<EmailLocale, Record<string, string>>;
  /** The guest cannot act on this email without their booking link. */
  needsGuestLink?: boolean;
}

export type TemplateVariables = Record<string, string | null | undefined>;

/** The finished email, as the worker hands it to a transport. */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}
