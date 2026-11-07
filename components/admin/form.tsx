"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useTransition,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { idleState, type ActionState } from "@/lib/admin/form-state";

export const FormContext = createContext<ActionState>(idleState);

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
  danger = false,
  resetOnOk = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel: string;
  children: ReactNode;
  danger?: boolean;
  /** Empties the boxes after a save, so a repeat tap cannot add it twice. */
  resetOnOk?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const [, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnOk && state.status === "ok") form.current?.reset();
  }, [resetOnOk, state]);

  // React clears a form after its action. Sending it from here does not.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return (
    <FormContext.Provider value={state}>
      <form
        ref={form}
        action={formAction}
        onSubmit={onSubmit}
        noValidate
        className="stack"
      >
        <FormMessage state={state} />
        {children}
        <button
          type="submit"
          className={danger ? "button button-danger" : "button"}
          disabled={pending}
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
    </FormContext.Provider>
  );
}

/** For a group of boxes, such as weekdays, which has no field of its own. */
export function FieldError({ name }: { name: string }) {
  const error = useContext(FormContext).fieldErrors?.[name];
  return error ? <p className="field-error">{error}</p> : null;
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  hint?: string;
}

export function Field({ label, name, hint, ...input }: FieldProps) {
  const error = useContext(FormContext).fieldErrors?.[name];
  // Unique per form: a page can hold the same field several times.
  const id = useId();
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
  hint,
  rows = 6,
}: {
  label: string;
  name: string;
  defaultValue: string;
  hint?: string;
  rows?: number;
}) {
  const error = useContext(FormContext).fieldErrors?.[name];
  // Unique per form: a page can hold the same field several times.
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
      />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export function SelectField({
  label,
  name,
  hint,
  options,
  ...select
}: SelectFieldProps) {
  const error = useContext(FormContext).fieldErrors?.[name];
  // Unique per form: a page can hold the same field several times.
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        {...select}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function CheckField({
  label,
  name,
  value,
  defaultChecked,
  hint,
}: {
  label: string;
  name: string;
  value?: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="choice">
      <input
        type="checkbox"
        name={name}
        value={value ?? "on"}
        defaultChecked={defaultChecked}
      />
      <span>
        {label}
        {hint && <span className="hint choice-hint">{hint}</span>}
      </span>
    </label>
  );
}

/** One button that does one thing, such as Mark as arrived. */
export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = "main",
  confirm,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  variant?: "main" | "quiet" | "danger";
  /** Asked first, for anything that cannot be undone with one tap. */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const className = {
    main: "button",
    quiet: "button button-quiet",
    danger: "button button-danger",
  }[variant];

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={className} disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
      {state.status === "error" && <FormMessage state={state} />}
    </form>
  );
}
