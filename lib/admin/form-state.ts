import type { ZodError } from "zod";
import { isMarker, later } from "@/lib/admin/later";

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

/**
 * Turns a Zod failure into one plain message per field, in the language of
 * `say`. Zod's own messages are English, so a field a schema gave no words for
 * gets a general one.
 */
export function fromZodError(
  error: ZodError,
  say: (text: string) => string,
): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= say(
      isMarker(issue.message) ? issue.message : later.admin.validation.invalid,
    );
  }
  return {
    status: "error",
    message: fieldErrors.form ?? say(later.admin.common.fixErrors),
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
