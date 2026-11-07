import { i18nFor, type AdminI18n } from "@/lib/admin/i18n";

// Starting points for Write to guest. The words live in lib/admin/strings.ts.
// A template is in the guest's language, whatever language the admin reads.
// They move to the email_templates table once a screen exists for Yorgos to
// edit them.

export interface MessageTemplate {
  key: string;
  label: string;
  subject: string;
  body: string;
}

interface TemplateFacts {
  name: string | null;
  reference: string | null;
  checkIn: string | null;
  checkOut: string | null;
  /** The booking's language. Anything but Greek gets English. */
  locale: string;
}

/** Filled in on the server, so he sees the real words before he saves. */
export function messageTemplates(
  facts: TemplateFacts,
  { t: screen }: AdminI18n,
): MessageTemplate[] {
  const { name, reference, checkIn, checkOut, locale } = facts;
  const guest = i18nFor(locale === "el" ? "el" : "en");
  const w = guest.t.write;
  const hello = w.greeting(name?.trim().split(/\s+/)[0] ?? null);
  const dates =
    checkIn && checkOut
      ? guest.t.common.dateRange(
          guest.formatDate(checkIn),
          guest.formatDate(checkOut),
        )
      : "";
  const ref = reference ? ` (${reference})` : "";
  const text = w.templateText;
  const labels = screen.write.templates;

  return [
    {
      key: "arrival",
      label: labels.arrival,
      subject: text.arrival.subject(ref),
      body: text.arrival.body(hello, dates),
    },
    {
      key: "balance",
      label: labels.balance,
      subject: text.balance.subject(ref),
      body: text.balance.body(hello, dates),
    },
    {
      key: "thanks",
      label: labels.thanks,
      subject: text.thanks.subject(),
      body: text.thanks.body(hello),
    },
  ];
}
