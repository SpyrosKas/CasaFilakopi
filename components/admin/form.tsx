"use client";

import {
  createContext,
  useActionState,
  useContext,
  useTransition,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { idleState, type ActionState } from "@/lib/admin/form-state";

const FormContext = createContext<ActionState>(idleState);

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={
        state.status === "ok" ? "notice notice-ok" : "notice notice-bad"
      }
      role={state.status === "ok" ? "status" : "alert"}
    >
      {state.message}
    </p>
  );
}

/**
 * A form that posts to a server action and keeps what was typed if it fails.
 * Checks happen on the server, so messages stay in plain words.
 */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [, startTransition] = useTransition();

  // React clears a form after its action. Sending it from here does not.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <FormContext.Provider value={state}>
      <form
        action={formAction}
        onSubmit={onSubmit}
        noValidate
        className="stack"
      >
        <FormMessage state={state} />
        {children}
        <button type="submit" className="button" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
    </FormContext.Provider>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  hint?: string;
}

export function Field({ label, name, hint, ...input }: FieldProps) {
  const error = useContext(FormContext).fieldErrors?.[name];
  const id = `field-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  const error = useContext(FormContext).fieldErrors?.[name];
  const id = `field-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        rows={6}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
