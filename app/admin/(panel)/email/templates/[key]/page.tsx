import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findTemplate, templateLabel } from "@/emails/registry";
import { requireOwner } from "@/lib/admin/session";
import { renderCopy } from "@/lib/email/render";
import { TemplateEditor } from "./template-editor";

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, lang: screen } = await adminI18n();
  const s = t.email.templates;

  const admin = await requireOwner();
  const { key } = await params;
  const { lang } = await searchParams;
  const def = findTemplate(key);
  if (!def || def.key !== key || !def.editable) notFound();
  const locale = lang === "en" ? "en" : "el";

  const { data, error } = await admin.supabase
    .from("email_templates")
    .select("subject, body")
    .eq("key", key)
    .eq("locale", locale)
    .maybeSingle();
  if (error) throw error;

  const copy = data ?? def.copy[locale];
  const preview = renderCopy(copy, {
    locale,
    values: def.sample[locale],
    brandName: "Casa Filakopi",
    footer: def.audience === "guest" ? ["host@example.com"] : [],
  });

  return (
    <div className="stack eml-wide">
      <h1>{s.editTitle(templateLabel(def, screen))}</h1>
      <Link
        href="/admin/email/templates"
        prefetch={false}
        className="text-link"
      >
        {s.backToList}
      </Link>
      <ul className="eml-filters">
        {(["el", "en"] as const).map((value) => (
          <li key={value}>
            <Link
              href={`/admin/email/templates/${key}?lang=${value}`}
              prefetch={false}
              aria-current={locale === value}
            >
              {value === "el" ? s.greek : s.english}
            </Link>
          </li>
        ))}
      </ul>
      <TemplateEditor
        key={`${key}/${locale}`}
        templateKey={key}
        locale={locale}
        copy={copy}
        placeholders={def.placeholders}
        isEdited={!!data}
        preview={{ problems: [], ...preview }}
      />
    </div>
  );
}
