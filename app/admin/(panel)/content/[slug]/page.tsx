import { notFound } from "next/navigation";
import {
  PageEditor,
  type EditorPhoto,
} from "@/components/admin/cms/page-editor";
import { requireOwner } from "@/lib/admin/session";
import { loadEditor } from "@/lib/cms/data";
import { publicMediaUrl } from "@/lib/cms/media-url";
import { findPage } from "@/lib/cms/registry";

type Props = { params: Promise<{ slug: string }> };

export default async function EditContentPage({ params }: Props) {
  const admin = await requireOwner();
  const { slug } = await params;
  const page = findPage(slug);
  if (!page) notFound();

  const { blocks, dirty, versions, hasPrevious } = await loadEditor(
    admin,
    page,
  );

  const sectionCollections = page.sections.flatMap((section) =>
    section.photos ? [section.photos] : [],
  );
  const stepCollections = page.sections.flatMap((section) =>
    section.list?.itemPhotos
      ? (blocks[section.key].items ?? []).map((item) => `step.${item.id}`)
      : [],
  );
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("collection, sort_order, media(path, width, height)")
    .in("collection", [...sectionCollections, ...stepCollections])
    .order("sort_order");
  if (error) throw error;

  const photos: Record<string, EditorPhoto> = {};
  for (const row of data) {
    const known = photos[row.collection];
    if (known) {
      known.count += 1;
    } else if (row.media) {
      photos[row.collection] = {
        src: publicMediaUrl(row.media.path),
        width: row.media.width ?? 1600,
        height: row.media.height ?? 1067,
        count: 1,
      };
    }
  }
  const stepPhotos = Object.fromEntries(
    stepCollections.flatMap((collection) =>
      photos[collection]
        ? [[collection.slice("step.".length), photos[collection]]]
        : [],
    ),
  );

  return (
    <PageEditor
      key={page.slug}
      page={page}
      initialBlocks={blocks}
      initialDirty={dirty}
      initialVersions={versions}
      hasPrevious={hasPrevious}
      sectionPhotos={photos}
      stepPhotos={stepPhotos}
    />
  );
}
