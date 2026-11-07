import { formatDate } from "@/lib/admin/format";
import { t } from "@/lib/admin/strings";

// Starting points for Write to guest. The words live in lib/admin/strings.ts.
// English only for now. They move to the email_templates table, with reviewed
// Greek, once a screen exists for Yorgos to edit them.

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
}

/** Filled in on the server, so he sees the real words before he saves. */
export function messageTemplates(facts: TemplateFacts): MessageTemplate[] {
  const { name, reference, checkIn, checkOut } = facts;
  const w = t.write;
  const hello = w.greeting(name?.trim().split(/\s+/)[0] ?? null);
  const dates =
    checkIn && checkOut
      ? t.common.dateRange(formatDate(checkIn), formatDate(checkOut))
      : "";
  const ref = reference ? ` (${reference})` : "";
  const text = w.templateText;

  return [
    {
      key: "arrival",
      label: w.templates.arrival,
      subject: text.arrival.subject(ref),
      body: text.arrival.body(hello, dates),
    },
    {
      key: "balance",
      label: w.templates.balance,
      subject: text.balance.subject(ref),
      body: text.balance.body(hello, dates),
    },
    {
      key: "thanks",
      label: w.templates.thanks,
      subject: text.thanks.subject(),
      body: text.thanks.body(hello),
    },
  ];
}
