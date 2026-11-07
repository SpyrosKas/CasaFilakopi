"use client";

import {
  useActionState,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { FormMessage } from "@/components/admin/form";
import { idleState } from "@/lib/admin/form-state";
import { t } from "@/lib/admin/strings";
import {
  previewTemplate,
  resetTemplate,
  saveTemplate,
  type PreviewState,
} from "@/lib/email/admin-actions";
import type { EmailLocale, TemplateCopy } from "@/emails/types";

const s = t.email.templates;

const WIDTHS = { phone: 375, computer: 640 };

export function TemplateEditor({
  templateKey,
  locale,
  copy,
  placeholders,
  isEdited,
  preview: initialPreview,
}: {
  templateKey: string;
  locale: EmailLocale;
  copy: TemplateCopy;
  placeholders: readonly string[];
  isEdited: boolean;
  preview: PreviewState;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, save, saving] = useActionState(saveTemplate, idleState);
  const [resetState, reset, resetting] = useActionState(
    resetTemplate,
    idleState,
  );
  const [preview, runPreview, previewing] = useActionState(
    previewTemplate,
    initialPreview,
  );
  const [, startTransition] = useTransition();
  const [width, setWidth] = useState<keyof typeof WIDTHS>("phone");

  const send = (action: (data: FormData) => void) => {
    const data = new FormData(form.current!);
    startTransition(() => action(data));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(save);
  };

  return (
    <>
      <form ref={form} onSubmit={onSubmit} className="stack eml-editor">
        <FormMessage state={state} />
        <FormMessage state={resetState} />
        <input type="hidden" name="key" value={templateKey} />
        <input type="hidden" name="locale" value={locale} />
        <div className="field">
          <label htmlFor="field-subject">{s.subject}</label>
          <input
            id="field-subject"
            name="subject"
            defaultValue={copy.subject}
          />
        </div>
        <div className="field">
          <label htmlFor="field-body">{s.body}</label>
          <textarea id="field-body" name="body" defaultValue={copy.body} />
        </div>
        <p className="hint">{s.placeholders}</p>
        <ul className="eml-chips">
          {placeholders.map((name) => (
            <li key={name}>
              <code>{`{{${name}}}`}</code>
            </li>
          ))}
        </ul>
        <p className="hint">{s.syntax}</p>
        <div className="eml-row">
          <button type="submit" className="button" disabled={saving}>
            {saving ? s.saving : s.save}
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={previewing}
            onClick={() => send(runPreview)}
          >
            {previewing ? s.previewing : s.preview}
          </button>
          {isEdited && (
            <button
              type="button"
              className="button button-quiet"
              disabled={resetting}
              onClick={() => send(reset)}
            >
              {s.reset}
            </button>
          )}
        </div>
      </form>

      <section className="stack">
        <h2>{s.preview}</h2>
        <p className="hint">{s.previewNote}</p>
        {preview.problems.map((problem) => (
          <p key={problem} className="notice notice-bad" role="alert">
            {problem}
          </p>
        ))}
        <p>
          <strong>{preview.subject}</strong>
        </p>
        <div className="eml-row">
          {(["phone", "computer"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="button button-quiet"
              aria-pressed={width === value}
              onClick={() => setWidth(value)}
            >
              {s[value]}
            </button>
          ))}
        </div>
        {/* No scripts or links can run: the sandbox has no permissions. */}
        <iframe
          className="eml-preview-frame"
          title={s.previewFrame}
          sandbox=""
          srcDoc={preview.html}
          style={{ width: WIDTHS[width] }}
        />
        <h3>{s.plainText}</h3>
        <pre className="eml-plain">{preview.text}</pre>
      </section>
    </>
  );
}
