import { notFound } from "next/navigation";
import { PhotoManager } from "@/components/admin/cms/photo-manager";
import { requireOwner } from "@/lib/admin/session";
import { loadCollection } from "@/lib/cms/data";
import { findCollection } from "@/lib/cms/registry";

type Props = { params: Promise<{ collection: string }> };

export default async function CollectionPhotosPage({ params }: Props) {
  const admin = await requireOwner();
  const { collection } = await params;
  const def = findCollection(decodeURIComponent(collection));
  if (!def) notFound();

  const items = await loadCollection(admin, def.id);
  return <PhotoManager key={def.id} def={def} initialItems={items} />;
}
