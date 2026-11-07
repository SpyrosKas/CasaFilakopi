"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { ConfirmDialog } from "@/components/admin/cms/confirm-dialog";
import {
  discardDraft,
  publishPage,
  saveDraft,
} from "@/lib/cms/actions/content";
import { emptyLanguage } from "@/lib/cms/checks";
import { safeHref } from "@/lib/cms/rich";
import { t } from "@/lib/cms/strings";
import {
  LANGS,
  type BlockData,
  type FieldDef,
  type FieldValues,
  type Lang,
  type ListDef,
  type PageDef,
  type SectionDef,
} from "@/lib/cms/types";

const e = t.editor;
const AUTOSAVE_MS = 1200;

export interface EditorPhoto {
  src: string;
  width: number;
  height: number;
  count: number;
}

type SaveState = "idle" | "saving" | "saved" | "failed";

/** Puts **, * or a link around what is selected in the text box. */
function surround(
  box: HTMLTextAreaElement,
  before: string,
  after: string,
): string {
  const { selectionStart: start, selectionEnd: end, value } = box;
  return (
    value.slice(0, start) +
    before +
    value.slice(start, end) +
    after +
    value.slice(end)
  );
}

function TextField({
  id,
  label,
  field,
  value,
  missing,
  onChange,
}: {
  id: string;
  label: string;
  field: FieldDef;
  value: string;
  missing: boolean;
  onChange: (value: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const multiline = field.kind === "rich" || field.kind === "text";
  const change = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange(event.target.value);

  const format = (before: string, after: string) => {
    if (box.current) onChange(surround(box.current, before, after));
  };
  const addLink = () => {
    const address = window.prompt(e.linkPrompt, "https://");
    if (address && safeHref(address)) format("[", `](${address.trim()})`);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {field.hint && <p className="hint">{field.hint}</p>}
      {field.kind === "rich" && (
        <div className="cms-toolbar">
          <button type="button" onClick={() => format("**", "**")}>
            <strong>{e.bold}</strong>
          </button>
          <button type="button" onClick={() => format("*", "*")}>
            <em>{e.italic}</em>
          </button>
          <button type="button" onClick={addLink}>
            {e.link}
          </button>
        </div>
      )}
      {multiline ? (
        <textarea
          ref={box}
          id={id}
          value={value}
          rows={Math.min(14, Math.max(4, Math.ceil(value.length / 45)))}
          onChange={change}
        />
      ) : (
        <input
          id={id}
          type={field.kind === "email" ? "email" : "text"}
          inputMode={field.kind === "url" ? "url" : undefined}
          value={value}
          onChange={change}
        />
      )}
      {field.kind === "rich" && <p className="hint">{e.formatHint}</p>}
      {missing && <p className="cms-missing">{e.missing(label)}</p>}
    </div>
  );
}

function LangFields({
  prefix,
  label,
  fields,
  values,
  onChange,
}: {
  prefix: string;
  label: string;
  fields: FieldDef[];
  values: Record<Lang, FieldValues>;
  onChange: (lang: Lang, field: string, value: string) => void;
}) {
  return fields.map((field) => {
    const empty = emptyLanguage(values, field);
    return (
      <div className="cms-langs" key={field.name}>
        {LANGS.map((lang) => (
          <div className={`cms-lang cms-lang-${lang}`} key={lang}>
            <TextField
              id={`${prefix}-${field.name}-${lang}`}
              label={`${label}: ${field.label} (${t.languages[lang]})`}
              field={field}
              value={values[lang]?.[field.name] ?? ""}
              missing={empty === lang}
              onChange={(value) => onChange(lang, field.name, value)}
            />
          </div>
        ))}
      </div>
    );
  });
}

function ListFields({
  section,
  list,
  block,
  stepPhotos,
  onChange,
}: {
  section: SectionDef;
  list: ListDef;
  block: BlockData;
  stepPhotos: Record<string, EditorPhoto>;
  onChange: (next: BlockData) => void;
}) {
  const items = block.items ?? [];

  const setItems = (next: typeof items) => onChange({ ...block, items: next });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setItems(next);
  };
  const add = () =>
    setItems([
      ...items,
      {
        id: `${list.idPrefix}-${crypto.randomUUID().slice(0, 8)}`,
        choice: list.choice.options[0].value,
        en: {},
        el: {},
      },
    ]);

  return (
    <div className="stack">
      {items.map((item, index) => {
        const heading = e.itemHeading(list.itemLabel, index + 1);
        const photo = stepPhotos[item.id];
        const update = (changes: Partial<typeof item>) =>
          setItems(
            items.map((other) =>
              other.id === item.id ? { ...other, ...changes } : other,
            ),
          );
        return (
          <div className="cms-item" key={item.id}>
            <div className="cms-item-head">
              <h3>{heading}</h3>
              <div className="cms-move">
                <button
                  type="button"
                  aria-label={`${t.common.moveUp}: ${heading}`}
                  aria-disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${t.common.moveDown}: ${heading}`}
                  aria-disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor={`${item.id}-choice`}>
                {`${heading}: ${list.choice.label}`}
              </label>
              <select
                id={`${item.id}-choice`}
                value={item.choice}
                onChange={(event) => update({ choice: event.target.value })}
              >
                {list.choice.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <LangFields
              prefix={`${section.key}-${item.id}`}
              label={`${section.label}: ${heading}`}
              fields={list.fields}
              values={item}
              onChange={(lang, field, value) =>
                update({ [lang]: { ...item[lang], [field]: value } })
              }
            />
            {list.itemPhotos && (
              <div className="cms-item-photo">
                {photo && (
                  <Image
                    src={photo.src}
                    width={photo.width}
                    height={photo.height}
                    alt=""
                    sizes="96px"
                  />
                )}
                <Link
                  className="text-link"
                  href={`/admin/photos/step.${item.id}`}
                  prefetch={false}
                >
                  {photo ? e.photosLink(1) : e.photosNone}
                </Link>
              </div>
            )}
            <button
              type="button"
              className="button button-quiet"
              onClick={() =>
                setItems(items.filter((other) => other.id !== item.id))
              }
            >
              {`${t.common.remove}: ${heading}`}
            </button>
          </div>
        );
      })}
      <button type="button" className="button button-quiet" onClick={add}>
        {list.addLabel}
      </button>
    </div>
  );
}

function SectionCard({
  section,
  block,
  open,
  photo,
  stepPhotos,
  onChange,
}: {
  section: SectionDef;
  block: BlockData;
  open: boolean;
  photo: EditorPhoto | undefined;
  stepPhotos: Record<string, EditorPhoto>;
  onChange: (next: BlockData) => void;
}) {
  const perLanguage = section.fields.filter((field) => !field.shared);
  const shared = section.fields.filter((field) => field.shared);

  return (
    <details className="cms-section" id={section.key} open={open}>
      <summary>{section.label}</summary>
      <div className="stack">
        {shared.map((field) => (
          <TextField
            key={field.name}
            id={`${section.key}-${field.name}`}
            label={`${section.label}: ${field.label}`}
            field={field}
            value={block.shared?.[field.name] ?? ""}
            missing={false}
            onChange={(value) =>
              onChange({
                ...block,
                shared: { ...block.shared, [field.name]: value },
              })
            }
          />
        ))}
        <LangFields
          prefix={section.key}
          label={section.label}
          fields={perLanguage}
          values={block}
          onChange={(lang, field, value) =>
            onChange({ ...block, [lang]: { ...block[lang], [field]: value } })
          }
        />
        {section.list && (
          <ListFields
            section={section}
            list={section.list}
            block={block}
            stepPhotos={stepPhotos}
            onChange={onChange}
          />
        )}
        {section.photos && (
          <Link
            className="text-link"
            href={`/admin/photos/${section.photos}`}
            prefetch={false}
          >
            {photo ? e.photosLink(photo.count) : e.photosNone}
          </Link>
        )}
        {section.link && (
          <Link className="text-link" href={section.link.href} prefetch={false}>
            {section.link.label}
          </Link>
        )}
      </div>
    </details>
  );
}

export function PageEditor({
  page,
  initialBlocks,
  initialDirty,
  sectionPhotos,
  stepPhotos,
}: {
  page: PageDef;
  initialBlocks: Record<string, BlockData>;
  initialDirty: boolean;
  sectionPhotos: Record<string, EditorPhoto>;
  stepPhotos: Record<string, EditorPhoto>;
}) {
  const [blocks, setBlocks] = useState(initialBlocks);
  const [lang, setLang] = useState<Lang>("el");
  const [dirty, setDirty] = useState(initialDirty);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyFields, setEmptyFields] = useState<string[] | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);

  const latest = useRef(blocks);
  const unsaved = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    // A link from the photo screen lands on its section, opened.
    const target = document.getElementById(window.location.hash.slice(1));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView();
    }
  }, []);

  /** Sends whatever changed. Saves run one at a time, in order. */
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    running.current = running.current.then(async () => {
      if (unsaved.current.size === 0) return true;
      const keys = [...unsaved.current];
      unsaved.current.clear();
      setSaveState("saving");
      const changed = Object.fromEntries(
        keys.map((key) => [key, latest.current[key]]),
      );
      const result = await saveDraft({
        slug: page.slug,
        blocks: changed,
      }).catch(() => null);
      if (!result?.ok) {
        keys.forEach((key) => unsaved.current.add(key));
        setSaveState("failed");
        setError(result?.message ?? e.draftFailed);
        return false;
      }
      setError(null);
      setSaveState("saved");
      return true;
    });
    return running.current;
  }, [page.slug]);

  const updateBlock = (key: string, next: BlockData) => {
    latest.current = { ...latest.current, [key]: next };
    setBlocks(latest.current);
    unsaved.current.add(key);
    setDirty(true);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  };

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved.current.size > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const preview = async (previewLang: Lang) => {
    // Opened first: phones block a new tab that follows a wait.
    const tab = window.open("about:blank", "_blank");
    await flush();
    const url = `/admin/content/preview?page=${page.slug}&lang=${previewLang}`;
    (tab ?? window).location.assign(url);
  };

  const publish = async (confirmedEmpty: boolean) => {
    setEmptyFields(null);
    setBusy(true);
    setMessage(null);
    const saved = await flush();
    const result = saved
      ? await publishPage({ slug: page.slug, confirmedEmpty }).catch(() => null)
      : null;
    setBusy(false);
    if (!saved) return;
    if (result?.ok) {
      setDirty(false);
      setError(null);
      setMessage(result.message ?? e.published);
    } else if (result?.emptyFields) {
      setEmptyFields(result.emptyFields);
    } else {
      setError(result?.message ?? t.common.somethingWrong);
    }
  };

  const discard = async () => {
    setConfirmDiscard(false);
    setBusy(true);
    await flush();
    const result = await discardDraft({ slug: page.slug }).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      // The server sends the published text back through the page's props.
      window.location.reload();
    } else {
      setError(result?.message ?? t.common.somethingWrong);
    }
  };

  return (
    <div className="cms-wide cms-editor stack" data-show={lang}>
      <div>
        <Link className="text-link" href="/admin/content" prefetch={false}>
          {e.allPages}
        </Link>
        <h1>{page.label}</h1>
      </div>
      <p>{e.intro}</p>

      <div className="cms-tabs" role="group" aria-label={e.tabsLabel}>
        {LANGS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={lang === option}
            onClick={() => setLang(option)}
          >
            {t.languages[option]}
          </button>
        ))}
      </div>

      {page.sections.map((section, index) => (
        <SectionCard
          key={section.key}
          section={section}
          block={blocks[section.key]}
          open={index === 0}
          photo={section.photos ? sectionPhotos[section.photos] : undefined}
          stepPhotos={stepPhotos}
          onChange={(next) => updateBlock(section.key, next)}
        />
      ))}

      <div className="cms-more-actions">
        {LANGS.map((option) => (
          <button
            key={option}
            type="button"
            className="button button-quiet"
            onClick={() => void preview(option)}
          >
            {e.preview(t.languages[option])}
          </button>
        ))}
        {dirty && (
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
          >
            {e.discard}
          </button>
        )}
      </div>

      <div className="cms-publish-bar" data-dirty={dirty || undefined}>
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice notice-ok" role="status">
            {message}
          </p>
        )}
        <div className="cms-publish-row">
          <p>
            <span
              className={dirty ? "cms-dirty" : ""}
              data-testid="publish-state"
            >
              {dirty ? e.unpublished : e.upToDate}
            </span>
            <span role="status" className="cms-save-state">
              {saveState === "saving" && e.savingDraft}
              {saveState === "saved" && e.draftSaved}
            </span>
          </p>
          <button
            type="button"
            className="button"
            disabled={busy || !dirty}
            onClick={() => void publish(false)}
          >
            {busy ? e.publishing : e.publish}
          </button>
        </div>
      </div>

      {emptyFields && (
        <ConfirmDialog
          title={e.emptyTitle}
          onClose={() => setEmptyFields(null)}
          actions={
            <button
              type="button"
              className="button"
              onClick={() => void publish(true)}
            >
              {e.publishAnyway}
            </button>
          }
        >
          <p>{e.emptyBody}</p>
          <ul className="cms-empty-list">
            {emptyFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
      {confirmDiscard && (
        <ConfirmDialog
          title={e.discardTitle}
          onClose={() => setConfirmDiscard(false)}
          actions={
            <button
              type="button"
              className="button"
              onClick={() => void discard()}
            >
              {e.discard}
            </button>
          }
        >
          <p>{e.discardBody}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
