import type { ZodError } from "zod";
import { t } from "@/lib/admin/strings";

/** What every admin server action returns to its form. */
export interface ActionState {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

export const idleState: ActionState = { status: "idle" };

export function okState(message: string): ActionState {
  return { status: "ok", message };
}

export function errorState(message: string): ActionState {
  return { status: "error", message };
}

/** Turns a Zod failure into one plain message per field. */
export function fromZodError(error: ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return {
    status: "error",
    message: fieldErrors.form ?? t.common.fixErrors,
    fieldErrors,
  };
}

/** The named text fields of a form, ready for a Zod schema. */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$")) fields[key] = value;
  }
  return fields;
}
