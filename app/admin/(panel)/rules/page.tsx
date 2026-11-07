import { adminI18n } from "@/lib/admin/i18n-server";
import { RulesForm } from "@/components/admin/rules-form";
import { requireOwner } from "@/lib/admin/session";
import { loadRules } from "@/lib/admin/settings-data";

export default async function RulesPage() {
  const { t } = await adminI18n();

  const admin = await requireOwner();
  const { rules, unreadable } = await loadRules(admin);

  return (
    <div className="stack">
      <h1>{t.rules.title}</h1>
      <p>{t.rules.intro}</p>
      {unreadable && <p className="notice notice-bad">{t.rules.unreadable}</p>}
      <RulesForm initial={rules} />
    </div>
  );
}
