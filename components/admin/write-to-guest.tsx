"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { useActionState, useEffect, useState, useTransition } from "react";
import { FormMessage } from "@/components/admin/form";
import { Panel } from "@/components/admin/panel";
import { queueGuestMessage } from "@/lib/admin/actions/messages";
import { idleState } from "@/lib/admin/form-state";
import { mailHref } from "@/lib/admin/contact";
import type { MessageTemplate } from "@/lib/admin/message-templates";

/**
 * Saves a message for the sender to pick up once email is connected. The link
 * opens the same words in his own email app, so nothing has to wait for that.
 */
export function WriteToGuest({
  target,
  id,
  email,
  locale,
  templates,
}: {
  target: "booking" | "external" | "contact";
  id: string;
  email: string | null;
  /** The booking's language, which the templates are written in. */
  locale: string;
  templates: MessageTemplate[];
}) {
  const { t, cms } = useAdminI18n();
  const w = t.write;

  const [state, formAction, pending] = useActionState(
    queueGuestMessage,
    idleState,
  );
  const [, startTransition] = useTransition();
  const [choice, setChoice] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (state.status !== "ok") return;
    // Clears the boxes once the server has the message.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice("");
    setSubject("");
    setBody("");
  }, [state]);

  const mail = mailHref(email);
  if (!mail) {
    return (
      <Panel title={w.title}>
        <p className="muted">{w.noEmail}</p>
      </Panel>
    );
  }

  const choose = (key: string) => {
    setChoice(key);
    const template = templates.find((row) => row.key === key);
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
  };

  const openInEmail = `${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Panel title={w.title}>
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <FormMessage state={state} />
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="id" value={id} />
        <div className="field">
          <label htmlFor="write-template">{w.template}</label>
          <select
            id="write-template"
            value={choice}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">{w.templateBlank}</option>
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.label}
              </option>
            ))}
          </select>
          {templates.length > 0 && (
            <p className="hint">
              {w.templateLanguage(
                locale === "el" ? cms.languages.el : cms.languages.en,
              )}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="write-subject">{w.subject}</label>
          <input
            id="write-subject"
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          {state.fieldErrors?.subject && (
            <p className="field-error">{state.fieldErrors.subject}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="write-body">{w.body}</label>
          <textarea
            id="write-body"
            name="body"
            rows={7}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          {state.fieldErrors?.body && (
            <p className="field-error">{state.fieldErrors.body}</p>
          )}
        </div>
        <div className="button-row">
          <button type="submit" className="button" disabled={pending}>
            {pending ? w.submitting : w.submit}
          </button>
          <a href={openInEmail} className="button button-quiet">
            {w.openEmail}
          </a>
        </div>
      </form>
    </Panel>
  );
}
