"use client";

import Image from "next/image";
import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { useAdminI18n } from "@/components/admin/language-provider";
import { useUnsavedWarning } from "@/components/admin/cms/use-unsaved-warning";
import { saveFocus, type PhotoResult } from "@/lib/cms/actions/photos";
import type { PhotoItem } from "@/lib/cms/data";

const CENTRE = { x: 50, y: 50 };
const STEP = 5;

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * Where a photo sits in frames of other shapes. The site crops to fill each
 * frame and keeps this spot in view, so Yorgos never needs a cropped copy.
 */
export function FocusEditor({
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

  const saved = item.focus;
  const [point, setPoint] = useState(saved ?? CENTRE);
  const [saving, setSaving] = useState(false);
  const changed =
    point.x !== (saved ?? CENTRE).x || point.y !== (saved ?? CENTRE).y;
  useUnsavedWarning(changed);

  const position = `${point.x}% ${point.y}%`;

  const pick = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setPoint({
      x: clamp(((event.clientX - box.left) / box.width) * 100),
      y: clamp(((event.clientY - box.top) / box.height) * 100),
    });
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setPoint((now) => ({
      x: clamp(now.x + move[0]),
      y: clamp(now.y + move[1]),
    }));
  };

  const save = async (focus: { x: number; y: number } | null) => {
    setSaving(true);
    const result = await saveFocus({
      collection,
      mediaId: item.mediaId,
      focus,
    }).catch(() => ({ ok: false as const, message: t.common.somethingWrong }));
    setSaving(false);
    if (result.ok) setPoint(focus ?? CENTRE);
    onSaved(result);
  };

  const isCentre = point.x === 50 && point.y === 50;

  return (
    <details className="cms-alt cms-focus">
      <summary>
        {p.focusHeading}
        {!saved && <span className="hint">{p.focusCentred}</span>}
      </summary>
      <div className="stack">
        <p className="hint">{p.focusHint}</p>
        <button
          type="button"
          className="cms-focus-picker"
          style={{ aspectRatio: `${item.width} / ${item.height}` }}
          aria-label={`${p.focusPicker}: ${point.x}%, ${point.y}%`}
          onClick={pick}
          onKeyDown={nudge}
        >
          <Image
            src={item.src}
            alt=""
            fill
            sizes="(min-width: 700px) 340px, 100vw"
            draggable={false}
          />
          <span
            className="cms-focus-mark"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
            aria-hidden
          />
        </button>
        <div className="cms-focus-previews">
          <figure>
            <div className="cms-focus-frame cms-focus-wide">
              <Image
                src={item.src}
                alt=""
                fill
                sizes="200px"
                style={{ objectFit: "cover", objectPosition: position }}
              />
            </div>
            <figcaption className="hint">{p.focusWide}</figcaption>
          </figure>
          <figure>
            <div className="cms-focus-frame cms-focus-tall">
              <Image
                src={item.src}
                alt=""
                fill
                sizes="120px"
                style={{ objectFit: "cover", objectPosition: position }}
              />
            </div>
            <figcaption className="hint">{p.focusTall}</figcaption>
          </figure>
        </div>
        <div className="cms-photo-actions">
          <button
            type="button"
            className="button button-quiet"
            disabled={saving || !changed}
            onClick={() => void save(isCentre ? null : point)}
          >
            {saving ? t.common.saving : p.focusSave}
          </button>
          {saved && (
            <button
              type="button"
              className="button button-quiet"
              disabled={saving}
              onClick={() => void save(null)}
            >
              {p.focusReset}
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
