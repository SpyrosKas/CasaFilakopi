"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import Image from "next/image";
import Link from "next/link";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ConfirmDialog } from "@/components/admin/cms/confirm-dialog";
import { useUnsavedWarning } from "@/components/admin/cms/use-unsaved-warning";
import {
  deleteEverywhere,
  finishUpload,
  removeFromSection,
  reorderPhotos,
  saveAlt,
  startUpload,
  type PhotoResult,
} from "@/lib/cms/actions/photos";
import {
  ACCEPTED_FILES,
  looksLikePhoto,
  MAX_CHOSEN_BYTES,
  MAX_UPLOAD_BYTES,
  putWithProgress,
  shrinkForUpload,
} from "@/lib/cms/browser-image";
import type { PhotoItem } from "@/lib/cms/data";
import type { CmsStrings } from "@/lib/cms/strings";
import type { CollectionDef } from "@/lib/cms/types";

const PHOTO_SIZES = "(min-width: 700px) 340px, 100vw";

/** Sends one file and returns the section as the server now has it. */
export async function uploadOne(
  file: File,
  collection: string,
  replaceMediaId: string | undefined,
  onProgress: (text: string) => void,
  p: CmsStrings["photos"],
): Promise<PhotoResult> {
  if (!looksLikePhoto(file)) {
    return { ok: false, message: p.wrongType(file.name) };
  }
  if (file.size > MAX_CHOSEN_BYTES) {
    return { ok: false, message: p.tooBig(file.name) };
  }
  onProgress(p.preparing(file.name));
  const blob = await shrinkForUpload(file);
  if (blob.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: p.tooBig(file.name) };
  }

  const ticket = await startUpload({ collection, size: blob.size });
  if (!ticket.ok) return { ok: false, message: p.uploadFailed(file.name) };

  const sent = await putWithProgress(ticket.url, blob, (percent) =>
    onProgress(p.uploading(file.name, percent)),
  );
  if (!sent) return { ok: false, message: p.uploadFailed(file.name) };

  onProgress(p.finishing(file.name));
  return finishUpload({
    collection,
    tempPath: ticket.path,
    replaceMediaId,
  }).catch(() => ({ ok: false, message: p.uploadFailed(file.name) }));
}

function AltEditor({
  item,
  collection,
  onSaved,
}: {
  item: PhotoItem;
  collection: string;
  onSaved: (result: PhotoResult) => void;
}) {
  const { cms: t } = useAdminI18n();
  const p = t.photos;

  const [en, setEn] = useState(item.alt.en);
  const [el, setEl] = useState(item.alt.el);
  const [saving, setSaving] = useState(false);
  const complete = Boolean(item.alt.en && item.alt.el);
  useUnsavedWarning(en !== item.alt.en || el !== item.alt.el);

  const save = async () => {
    setSaving(true);
    const result = await saveAlt({
      collection,
      mediaId: item.mediaId,
      en,
      el,
    }).catch(() => ({ ok: false as const, message: t.common.somethingWrong }));
    setSaving(false);
    onSaved(result);
  };

  const missing = !item.alt.en && !item.alt.el;
  return (
    <details className="cms-alt" open={!complete}>
      <summary>
        {p.altHeading}
        {missing && <span className="cms-badge-warn">{p.altMissing}</span>}
        {!missing && !complete && (
          <span className="cms-badge-warn">
            {p.altOneMissing(item.alt.el ? t.languages.en : t.languages.el)}
          </span>
        )}
      </summary>
      <div className="stack">
        <p className="hint">{p.altPrompt}</p>
        <div className="field">
          <label htmlFor={`alt-el-${item.mediaId}`}>{p.altGreek}</label>
          <input
            id={`alt-el-${item.mediaId}`}
            lang="el"
            value={el}
            maxLength={300}
            onChange={(event) => setEl(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`alt-en-${item.mediaId}`}>{p.altEnglish}</label>
          <input
            id={`alt-en-${item.mediaId}`}
            value={en}
            maxLength={300}
            onChange={(event) => setEn(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="button button-quiet"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t.common.saving : t.common.save}
        </button>
      </div>
    </details>
  );
}

export function PhotoManager({
  def,
  initialItems,
}: {
  def: CollectionDef;
  initialItems: PhotoItem[];
}) {
  const { cms: t, say } = useAdminI18n();
  const p = t.photos;

  const [items, setItems] = useState(initialItems);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<PhotoItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);

  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | undefined>(undefined);
  const orderQueue = useRef<Promise<void>>(Promise.resolve());

  const apply = (result: PhotoResult, fallback?: string) => {
    if (result.ok) {
      setItems(result.items);
      const text = result.message ?? fallback;
      if (text) setNotice({ ok: true, text });
    } else {
      setNotice({ ok: false, text: result.message });
    }
    return result.ok;
  };

  const upload = async (files: File[], replaceMediaId?: string) => {
    if (files.length === 0) return;
    setBusy(true);
    setNotice(null);
    const problems: string[] = [];
    let added = 0;
    for (const [index, file] of files.entries()) {
      const prefix = `${p.progress(index + 1, files.length)}. `;
      const result = await uploadOne(
        file,
        def.id,
        replaceMediaId,
        (text) => setProgress(prefix + text),
        p,
      );
      if (result.ok) {
        setItems(result.items);
        added += 1;
      } else {
        problems.push(result.message);
      }
    }
    setProgress(null);
    setBusy(false);
    if (problems.length) {
      setNotice({ ok: false, text: problems.join(" ") });
    } else if (added) {
      setNotice({
        ok: true,
        text: replaceMediaId || def.single ? p.replaced : p.uploadDone(added),
      });
    }
  };

  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void upload(files);
  };

  const onReplaceChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].slice(0, 1);
    event.target.value = "";
    void upload(files, replaceTarget.current);
  };

  /** Moves show at once. Saves go one at a time, each with the whole order. */
  const saveOrder = (next: PhotoItem[], message: string) => {
    const before = items;
    setItems(next);
    setNotice(null);
    orderQueue.current = orderQueue.current.then(async () => {
      const result = await reorderPhotos({
        collection: def.id,
        ids: next.map((item) => item.mediaId),
      }).catch(() => null);
      if (result?.ok) {
        setNotice({ ok: true, text: message });
      } else {
        setItems(before);
        setNotice({
          ok: false,
          text: result?.message ?? t.common.somethingWrong,
        });
      }
    });
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    saveOrder(next, to === 0 ? p.coverSaved : p.moved(to + 1, next.length));
  };

  const onDrop = (event: DragEvent, target: string) => {
    event.preventDefault();
    const from = items.findIndex((item) => item.mediaId === dragged);
    const to = items.findIndex((item) => item.mediaId === target);
    setDragged(null);
    if (from !== -1 && to !== -1) move(from, to);
  };

  const run = async (action: () => Promise<PhotoResult>) => {
    setBusy(true);
    setDeleting(null);
    const result = await action().catch(() => ({
      ok: false as const,
      message: t.common.somethingWrong,
    }));
    setBusy(false);
    return result;
  };

  const removeHere = async (item: PhotoItem) => {
    const result = await run(() =>
      removeFromSection({ collection: def.id, mediaId: item.mediaId }),
    );
    apply(result);
  };

  const removeEverywhere = async (item: PhotoItem) => {
    const result = await run(() => deleteEverywhere({ mediaId: item.mediaId }));
    if (result.ok) {
      setItems((current) =>
        current.filter((other) => other.mediaId !== item.mediaId),
      );
      setNotice({ ok: true, text: result.message ?? p.deleted });
    } else {
      setNotice({ ok: false, text: result.message });
    }
  };

  const canDelete = !def.single || def.optional;
  const canAdd = !def.single || items.length === 0;
  const total = items.length;

  return (
    <div className="stack cms-wide">
      <div>
        <Link className="text-link" href="/admin/photos" prefetch={false}>
          {p.allPhotos}
        </Link>
        <h1>{def.label}</h1>
      </div>
      <p className="notice notice-info">{p.liveNote}</p>
      {def.decorative && <p className="hint">{p.decorative}</p>}
      {def.textOn && (
        <Link className="text-link" href={def.textOn} prefetch={false}>
          {p.editText}
        </Link>
      )}

      {canAdd && (
        <div className="cms-upload">
          <label className="button">
            {def.single ? p.addOne : p.add}
            <input
              type="file"
              className="cms-file-input"
              accept={ACCEPTED_FILES}
              multiple={!def.single}
              disabled={busy}
              onChange={onChoose}
            />
          </label>
          <p className="hint">{p.addHint}</p>
        </div>
      )}
      <input
        ref={replaceInput}
        type="file"
        className="cms-file-input"
        accept={ACCEPTED_FILES}
        aria-hidden="true"
        tabIndex={-1}
        onChange={onReplaceChosen}
      />

      {progress && (
        <p className="notice notice-info" role="status">
          {progress}
        </p>
      )}
      {notice && (
        <p
          className={notice.ok ? "notice notice-ok" : "notice notice-bad"}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.text}
        </p>
      )}

      {total === 0 && <p>{p.none}</p>}
      {total > 1 && <p className="hint">{p.coverHint}</p>}

      <ol className="cms-photos">
        {items.map((item, index) => {
          const position = p.positionOf(index + 1, total);
          return (
            <li
              key={item.mediaId}
              className="cms-photo"
              data-dragging={dragged === item.mediaId || undefined}
              draggable={total > 1}
              onDragStart={() => setDragged(item.mediaId)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, item.mediaId)}
            >
              <div className="cms-photo-frame">
                <Image
                  src={item.src}
                  width={item.width}
                  height={item.height}
                  alt={item.alt.en || item.alt.el || position}
                  sizes={PHOTO_SIZES}
                  draggable={false}
                />
                {index === 0 && total > 1 && (
                  <span className="cms-cover">{p.cover}</span>
                )}
              </div>
              <p className="hint">{position}</p>
              {item.usedElsewhere.length > 0 && (
                <p className="hint">
                  {p.usedElsewhere(item.usedElsewhere.map(say).join(", "))}
                </p>
              )}
              {!def.decorative && (
                <AltEditor
                  key={`${item.alt.en}|${item.alt.el}`}
                  item={item}
                  collection={def.id}
                  onSaved={(result) => apply(result)}
                />
              )}
              <div className="cms-photo-actions">
                {total > 1 && (
                  <>
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`${t.common.moveUp}: ${position}`}
                      aria-disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑ {t.common.moveUp}
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      aria-label={`${t.common.moveDown}: ${position}`}
                      aria-disabled={index === total - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓ {t.common.moveDown}
                    </button>
                    {index > 0 && (
                      <button
                        type="button"
                        className="button button-quiet"
                        aria-label={`${p.makeCover}: ${position}`}
                        onClick={() => move(index, 0)}
                      >
                        {p.makeCover}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="button button-quiet"
                  aria-label={`${p.replace}: ${position}`}
                  disabled={busy}
                  onClick={() => {
                    replaceTarget.current = item.mediaId;
                    replaceInput.current?.click();
                  }}
                >
                  {p.replace}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-label={`${p.deleteButton}: ${position}`}
                    disabled={busy}
                    onClick={() => setDeleting(item)}
                  >
                    {p.deleteButton}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {deleting && (
        <ConfirmDialog
          title={p.deleteTitle}
          onClose={() => setDeleting(null)}
          actions={
            <>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => void removeHere(deleting)}
              >
                {p.removeFromSection}
              </button>
              {deleting.blockedBy.length === 0 && (
                <button
                  type="button"
                  className="button cms-danger"
                  onClick={() => void removeEverywhere(deleting)}
                >
                  {p.deleteEverywhere}
                </button>
              )}
            </>
          }
        >
          <p>
            {deleting.usedElsewhere.length
              ? p.deleteShared(deleting.usedElsewhere.map(say).join(", "))
              : p.deleteOnlyHere}
          </p>
          {deleting.blockedBy.length > 0 && (
            <p className="notice notice-info">
              {p.needsOneElsewhere(deleting.blockedBy.map(say).join(", "))}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
