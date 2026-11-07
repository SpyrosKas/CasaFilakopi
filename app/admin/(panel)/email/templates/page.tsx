import Link from "next/link";
import { TEMPLATES } from "@/emails/registry";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

const s = t.email.templates;

export default async function EmailTemplatesPage() {
  const admin = await requireOwner();
  const { data, error } = await admin.supabase
    .from("email_templates")
    .select("key, locale");
  if (error) throw error;

  const edited = new Set(data.map((row) => `${row.key}/${row.locale}`));
  const editable = TEMPLATES.filter((template) => template.editable);

  const group = (audience: "guest" | "host", heading: string) => (
    <section className="stack">
      <h2>{heading}</h2>
      <ul className="eml-list">
        {editable
          .filter((template) => template.audience === audience)
          .map((template) => (
            <li key={template.key} className="eml-item">
              <span>{template.label}</span>
              <div className="eml-row">
                {(["el", "en"] as const).map((locale) => (
                  <Link
                    key={locale}
                    href={`/admin/email/templates/${template.key}?lang=${locale}`}
                    prefetch={false}
                    className="button button-quiet"
                  >
                    {locale === "el" ? s.greek : s.english}
                    {edited.has(`${template.key}/${locale}`) &&
                      ` (${s.edited})`}
                  </Link>
                ))}
              </div>
            </li>
          ))}
      </ul>
    </section>
  );

  return (
    <div className="stack eml-wide">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/email" prefetch={false} className="text-link">
        {s.back}
      </Link>
      {group("guest", s.guestHeading)}
      {group("host", s.hostHeading)}
    </div>
  );
}
