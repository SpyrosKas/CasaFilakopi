"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/admin/cms/confirm-dialog";
import { useUnsavedWarning } from "@/components/admin/cms/use-unsaved-warning";
import {
  deleteListEntry,
  reorderList,
  saveListEntry,
  setListStatus,
  type ListResult,
} from "@/lib/cms/actions/lists";
import type { ListEntry } from "@/lib/cms/data";
import type { ListKind } from "@/lib/cms/schemas";
import { t } from "@/lib/cms/strings";
import { LANGS, type Lang } from "@/lib/cms/types";

const l = t.lists;

export interface PhotoChoice {
  id: string;
  src: string;
  width: number;
  height: number;
}

const headings: Record<ListKind, { title: string; add: string }> = {
  faq: l.faq,
  testimonials: l.testimonials,
  places: l.places,
};

type Values = Record<string, string>;

const titleOf = (kind: ListKind, values: Values): string => {
  if (kind === "faq") return values.question_el || values.question_en;
  if (kind === "testimonials") return values.author;
  return values.name_el || values.name_en;
};

function toInput(
  kind: ListKind,
  id: string | undefined,
  values: Values,
  mediaId: string | null,
) {
  const both = (prefix: string) => ({
    en: values[`${prefix}_en`] ?? "",
    el: values[`${prefix}_el`] ?? "",
  });
  if (kind === "faq") {
    return { kind, id, question: both("question"), answer: both("answer") };
  }
  if (kind === "testimonials") {
    return {
      kind,
      id,
      author: values.author ?? "",
      text: both("text"),
      teaser: both("teaser"),
      stars: Number(values.stars ?? 5),
    };
  }
  return {
    kind,
    id,
    name: both("name"),
    description: both("description"),
    mediaId,
  };
}

function LangField({
  id,
  label,
  prefix,
  values,
  long,
  onChange,
}: {
  id: string;
  label: string;
  prefix: string;
  values: Values;
  long?: boolean;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="cms-langs cms-langs-always">
      {LANGS.map((lang: Lang) => {
        const name = `${prefix}_${lang}`;
        const fieldId = `${id}-${name}`;
        const fieldLabel = `${label} (${t.languages[lang]})`;
        return (
          <div className="field" key={lang}>
            <label htmlFor={fieldId}>{fieldLabel}</label>
            {long ? (
              <textarea
                id={fieldId}
                rows={5}
                value={values[name] ?? ""}
                onChange={(event) => onChange(name, event.target.value)}
              />
            ) : (
              <input
                id={fieldId}
                value={values[name] ?? ""}
                onChange={(event) => onChange(name, event.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhotoPicker({
  name,
  choices,
  value,
  onChange,
}: {
  name: string;
  choices: PhotoChoice[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <details className="cms-alt">
      <summary>{l.choosePhoto}</summary>
      <div className="cms-picker">
        <label>
          <input
            type="radio"
            name={name}
            checked={value === null}
            onChange={() => onChange(null)}
          />
          {l.noPhoto}
        </label>
        {choices.map((choice, index) => (
          <label key={choice.id}>
            <input
              type="radio"
              name={name}
              checked={value === choice.id}
              onChange={() => onChange(choice.id)}
            />
            <Image
              src={choice.src}
              width={choice.width}
              height={choice.height}
              alt={t.photos.positionOf(index + 1, choices.length)}
              sizes="120px"
            />
          </label>
        ))}
      </div>
    </details>
  );
}

function EntryForm({
  kind,
  id,
  initial,
  initialMediaId,
  choices,
  onSave,
  children,
}: {
  kind: ListKind;
  id: string | undefined;
  initial: Values;
  initialMediaId: string | null;
  choices: PhotoChoice[];
  onSave: (input: unknown) => Promise<boolean>;
  children?: ReactNode;
}) {
  const [values, setValues] = useState(initial);
  const [mediaId, setMediaId] = useState(initialMediaId);
  const [saving, setSaving] = useState(false);
  const formId = id ?? "new";
  useUnsavedWarning(
    mediaId !== initialMediaId ||
      Object.keys({ ...initial, ...values }).some(
        (key) => (values[key] ?? "") !== (initial[key] ?? ""),
      ),
  );

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));
  const field = { id: formId, values, onChange: set };

  const save = async () => {
    setSaving(true);
    const saved = await onSave(toInput(kind, id, values, mediaId));
    setSaving(false);
    if (saved && !id) setValues({});
  };

  return (
    <div className="stack">
      {kind === "faq" && (
        <>
          <LangField {...field} label={l.faq.question} prefix="question" />
          <LangField {...field} label={l.faq.answer} prefix="answer" long />
        </>
      )}
      {kind === "testimonials" && (
        <>
          <div className="field">
            <label htmlFor={`${formId}-author`}>{l.testimonials.author}</label>
            <input
              id={`${formId}-author`}
              value={values.author ?? ""}
              onChange={(event) => set("author", event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-stars`}>{l.testimonials.stars}</label>
            <select
              id={`${formId}-stars`}
              value={values.stars ?? "5"}
              onChange={(event) => set("stars", event.target.value)}
            >
              {["5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1"].map(
                (stars) => (
                  <option key={stars}>{stars}</option>
                ),
              )}
            </select>
          </div>
          <LangField
            {...field}
            label={l.testimonials.teaser}
            prefix="teaser"
            long
          />
          <LangField
            {...field}
            label={l.testimonials.text}
            prefix="text"
            long
          />
        </>
      )}
      {kind === "places" && (
        <>
          <LangField {...field} label={l.places.name} prefix="name" />
          <LangField
            {...field}
            label={l.places.description}
            prefix="description"
            long
          />
          <PhotoPicker
            name={`${formId}-photo`}
            choices={choices}
            value={mediaId}
            onChange={setMediaId}
          />
        </>
      )}
      <div className="cms-photo-actions">
        <button
          type="button"
          className="button"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t.common.saving : t.common.save}
        </button>
        {children}
      </div>
    </div>
  );
}

export function ListEditor({
  kind,
  initialEntries,
  choices,
}: {
  kind: ListKind;
  initialEntries: ListEntry[];
  choices: PhotoChoice[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<ListEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const heading = headings[kind];

  const apply = (result: ListResult | null): boolean => {
    if (result?.ok) {
      setEntries(result.entries);
      setNotice({ ok: true, text: result.message });
      return true;
    }
    setNotice({
      ok: false,
      text: result?.message ?? t.common.somethingWrong,
    });
    return false;
  };

  const save = async (input: unknown) => {
    const result = await saveListEntry(input).catch(() => null);
    const saved = apply(result);
    if (saved && (input as { id?: string }).id === undefined) setAdding(false);
    return saved;
  };

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= entries.length) return;
    const next = [...entries];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    setEntries(next);
    apply(
      await reorderList({ kind, ids: next.map((e) => e.id) }).catch(() => null),
    );
  };

  return (
    <div className="stack cms-wide">
      <div>
        <Link className="text-link" href="/admin/content" prefetch={false}>
          {t.common.back}
        </Link>
        <h1>{heading.title}</h1>
      </div>
      <p className="notice notice-info">{l.liveNote}</p>
      {notice && (
        <p
          className={notice.ok ? "notice notice-ok" : "notice notice-bad"}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.text}
        </p>
      )}

      {adding ? (
        <div className="cms-section cms-section-open">
          <h2>{heading.add}</h2>
          <EntryForm
            kind={kind}
            id={undefined}
            initial={{}}
            initialMediaId={null}
            choices={choices}
            onSave={save}
          >
            <button
              type="button"
              className="button button-quiet"
              onClick={() => setAdding(false)}
            >
              {t.common.cancel}
            </button>
          </EntryForm>
        </div>
      ) : (
        <button
          type="button"
          className="button"
          onClick={() => setAdding(true)}
        >
          {heading.add}
        </button>
      )}

      {entries.length === 0 && !adding && <p>{l.empty}</p>}

      {entries.map((entry, index) => {
        const title = titleOf(kind, entry.values);
        const published = entry.status === "published";
        return (
          <details className="cms-section" key={entry.id}>
            <summary>
              {title}
              <span className={published ? "cms-badge-ok" : "cms-badge-warn"}>
                {l.status[entry.status]}
              </span>
            </summary>
            <div className="stack">
              <div className="cms-move">
                <button
                  type="button"
                  aria-label={`${t.common.moveUp}: ${title}`}
                  aria-disabled={index === 0}
                  onClick={() => void move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${t.common.moveDown}: ${title}`}
                  aria-disabled={index === entries.length - 1}
                  onClick={() => void move(index, index + 1)}
                >
                  ↓
                </button>
              </div>
              <EntryForm
                kind={kind}
                id={entry.id}
                initial={entry.values}
                initialMediaId={entry.mediaId ?? null}
                choices={choices}
                onSave={save}
              >
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() =>
                    void setListStatus({
                      kind,
                      id: entry.id,
                      status: published ? "draft" : "published",
                    })
                      .catch(() => null)
                      .then(apply)
                  }
                >
                  {published ? l.unpublish : l.publish}
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => setDeleting(entry)}
                >
                  {l.delete}
                </button>
              </EntryForm>
            </div>
          </details>
        );
      })}

      {deleting && (
        <ConfirmDialog
          title={l.deleteTitle}
          onClose={() => setDeleting(null)}
          actions={
            <button
              type="button"
              className="button cms-danger"
              onClick={() => {
                const { id } = deleting;
                setDeleting(null);
                void deleteListEntry({ kind, id })
                  .catch(() => null)
                  .then(apply);
              }}
            >
              {l.deleteConfirm}
            </button>
          }
        >
          <p>{l.deleteBody}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
