import { RulesForm } from "@/components/admin/rules-form";
import { requireOwner } from "@/lib/admin/session";
import { loadRules } from "@/lib/admin/settings-data";
import { t } from "@/lib/admin/strings";

export default async function RulesPage() {
  const admin = await requireOwner();
  const rules = await loadRules(admin);

  return (
    <div className="stack">
      <h1>{t.rules.title}</h1>
      <p>{t.rules.intro}</p>
      <RulesForm initial={rules} />
    </div>
  );
}
