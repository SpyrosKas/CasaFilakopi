import { adminI18n } from "@/lib/admin/i18n-server";
import Image from "next/image";
import Link from "next/link";
import { requireOwner } from "@/lib/admin/session";
import { loadPhotoOverview, type CollectionSummary } from "@/lib/cms/data";

function groupsOf(summaries: CollectionSummary[]) {
  const groups = new Map<string, CollectionSummary[]>();
  for (const summary of summaries) {
    groups.set(summary.def.group, [
      ...(groups.get(summary.def.group) ?? []),
      summary,
    ]);
  }
  return [...groups];
}

export default async function PhotosPage() {
  const { cms: t, sayAll } = await adminI18n();
  const p = t.photos;

  const admin = await requireOwner();
  const { summaries, unused } = await loadPhotoOverview(admin);

  return (
    <div className="stack cms-wide">
      <div>
        <Link className="text-link" href="/admin/content" prefetch={false}>
          {t.common.back}
        </Link>
        <h1>{p.title}</h1>
      </div>
      <p>{p.intro}</p>
      {groupsOf(sayAll(summaries)).map(([group, items]) => (
        <section className="stack" key={group}>
          <h2>{group}</h2>
          <ul className="cms-overview">
            {items.map(({ def, count, needsText, cover }) => (
              <li key={def.id}>
                <Link href={`/admin/photos/${def.id}`} prefetch={false}>
                  {cover && (
                    <Image
                      src={cover.src}
                      width={cover.width}
                      height={cover.height}
                      alt=""
                      sizes="72px"
                    />
                  )}
                  <span>
                    <strong>{def.label}</strong>
                    {count ? p.count(count) : p.none}
                    {needsText > 0 && (
                      <>
                        <br />
                        <span className="cms-badge-warn">
                          {p.needsText(needsText)}
                        </span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ul className="link-list">
        <li>
          <Link href="/admin/photos/unused" prefetch={false}>
            {p.unusedLink(unused)}
          </Link>
        </li>
      </ul>
    </div>
  );
}
