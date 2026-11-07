"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/admin/cms/confirm-dialog";
import {
  addExistingPhoto,
  deleteEverywhere,
  type PhotoResult,
} from "@/lib/cms/actions/photos";
import type { PhotoItem } from "@/lib/cms/data";

export function UnusedPhotos({
  initialItems,
  sections,
}: {
  initialItems: PhotoItem[];
  sections: { id: string; label: string }[];
}) {
  const { cms: t } = useAdminI18n();
  const p = t.photos;

  const [items, setItems] = useState(initialItems);
  const [deleting, setDeleting] = useState<PhotoItem | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const finish = (result: PhotoResult) => {
    setDeleting(null);
    if (result.ok) setItems(result.items);
    setNotice({
      ok: result.ok,
      text: result.message ?? t.common.saved,
    });
  };
  const failed = () => ({
    ok: false as const,
    message: t.common.somethingWrong,
  });

  return (
    <div className="stack cms-wide">
      <div>
        <Link className="text-link" href="/admin/photos" prefetch={false}>
          {p.allPhotos}
        </Link>
        <h1>{p.unusedTitle}</h1>
      </div>
      <p>{p.unusedIntro}</p>
      {notice && (
        <p
          className={notice.ok ? "notice notice-ok" : "notice notice-bad"}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.text}
        </p>
      )}
      {items.length === 0 && <p>{p.unusedEmpty}</p>}
      <ul className="cms-photos">
        {items.map((item, index) => {
          const name = p.positionOf(index + 1, items.length);
          const section = chosen[item.mediaId] ?? sections[0]?.id;
          return (
            <li className="cms-photo" key={item.mediaId}>
              <div className="cms-photo-frame">
                <Image
                  src={item.src}
                  width={item.width}
                  height={item.height}
                  alt={item.alt.en || item.alt.el || name}
                  sizes="(min-width: 700px) 340px, 100vw"
                />
              </div>
              <div className="field">
                <label htmlFor={`section-${item.mediaId}`}>
                  {p.addToSectionLabel}
                </label>
                <select
                  id={`section-${item.mediaId}`}
                  value={section}
                  onChange={(event) =>
                    setChosen({
                      ...chosen,
                      [item.mediaId]: event.target.value,
                    })
                  }
                >
                  {sections.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cms-photo-actions">
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() =>
                    void addExistingPhoto({
                      collection: section,
                      mediaId: item.mediaId,
                    })
                      .catch(failed)
                      .then(finish)
                  }
                >
                  {p.addToSection}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={`${p.deleteButton}: ${name}`}
                  onClick={() => setDeleting(item)}
                >
                  {p.deleteButton}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {deleting && (
        <ConfirmDialog
          title={p.deleteTitle}
          onClose={() => setDeleting(null)}
          actions={
            <button
              type="button"
              className="button cms-danger"
              onClick={() =>
                void deleteEverywhere({ mediaId: deleting.mediaId })
                  .catch(failed)
                  .then(finish)
              }
            >
              {p.deletePermanent}
            </button>
          }
        >
          <p>{p.deleteOnlyHere}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
