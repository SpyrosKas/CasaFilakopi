import { UnusedPhotos } from "@/components/admin/cms/unused-photos";
import { adminI18n } from "@/lib/admin/i18n-server";
import { requireOwner } from "@/lib/admin/session";
import { loadUnused } from "@/lib/cms/data";
import { fixedCollections } from "@/lib/cms/registry";

export default async function UnusedPhotosPage() {
  const admin = await requireOwner();
  const items = await loadUnused(admin);
  const { say } = await adminI18n();
  const sections = fixedCollections()
    .filter((def) => !def.single)
    .map(({ id, label }) => ({ id, label: say(label) }));

  return <UnusedPhotos initialItems={items} sections={sections} />;
}
