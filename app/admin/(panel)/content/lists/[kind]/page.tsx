import { notFound } from "next/navigation";
import { ListEditor } from "@/components/admin/cms/list-editor";
import { requireOwner } from "@/lib/admin/session";
import { loadList, loadPhotoChoices } from "@/lib/cms/data";
import { listKindSchema } from "@/lib/cms/schemas";

type Props = { params: Promise<{ kind: string }> };

export default async function EditListPage({ params }: Props) {
  const admin = await requireOwner();
  const parsed = listKindSchema.safeParse((await params).kind);
  if (!parsed.success) notFound();
  const kind = parsed.data;

  const [entries, choices] = await Promise.all([
    loadList(admin, kind),
    kind === "places" ? loadPhotoChoices(admin) : [],
  ]);

  return <ListEditor kind={kind} initialEntries={entries} choices={choices} />;
}
