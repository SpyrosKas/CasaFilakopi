import Link from "next/link";
import { requireOwner } from "@/lib/admin/session";
import { loadDirtyPages } from "@/lib/cms/data";
import { allPages } from "@/lib/cms/registry";
import type { ListKind } from "@/lib/cms/schemas";
import { t } from "@/lib/cms/strings";

const h = t.hub;
const lists: ListKind[] = ["faq", "testimonials", "places"];

export default async function ContentHomePage() {
  const admin = await requireOwner();
  const dirty = await loadDirtyPages(admin);

  return (
    <div className="stack cms-wide">
      <h1>{h.title}</h1>
      <p>{h.intro}</p>

      <h2>{h.photosHeading}</h2>
      <ul className="link-list">
        <li>
          <Link href="/admin/photos" prefetch={false}>
            {h.photosLink}
          </Link>
        </li>
      </ul>
      <p className="hint">{h.photosHint}</p>

      <h2>{h.textHeading}</h2>
      <ul className="link-list">
        {allPages().map((page) => (
          <li key={page.slug}>
            <Link href={`/admin/content/${page.slug}`} prefetch={false}>
              <span className="cms-link-row">
                {page.label}
                {dirty.includes(page.slug) && (
                  <span className="cms-badge-warn">{h.unpublished}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>{h.listsHeading}</h2>
      <ul className="link-list">
        {lists.map((kind) => (
          <li key={kind}>
            <Link href={`/admin/content/lists/${kind}`} prefetch={false}>
              {h.lists[kind]}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
