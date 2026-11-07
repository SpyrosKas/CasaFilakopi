"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BOOKING_PLACEHOLDERS, findTemplate } from "@/emails/registry";
import type { EmailLocale, TemplateCopy } from "@/emails/types";
import { writeAudit } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { createAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";
import { athensDate } from "@/lib/domain/dates";
import { queueEmailWith } from "./queue";
import { renderCopy } from "./render";
import {
  athensInstant,
  loadScheduledRules,
  ruleTextProblems,
  SCHEDULED_RULES_KEY,
  type ScheduledRule,
} from "./scheduled";
import { loadEmailSettings, parseEmailSettings } from "./settings";
import { validateCopy, validateText } from "./template-text";
import { SKIPPED_PREFIX } from "./worker";

// Settings and texts go through the Owner's own client, so RLS applies and the
// audit trigger names them. email_logs has no write access for signed-in users,
// so its changes need the secret key, which skips the MFA check: the role is
// checked first.

const s = t.email;

async function secretClient(admin: AdminContext) {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error) throw error;
  if (role !== "owner") throw new Error("not_authorised");
  return createAdminClient();
}

const whole = (min: number, max: number) =>
  z.coerce
    .number({ error: s.settings.invalidNumber })
    .int(s.settings.invalidNumber)
    .min(min, s.settings.invalidNumber)
    .max(max, s.settings.invalidNumber);

const settingsForm = z.object({
  senderName: z.string().trim().min(1, t.validation.required).max(100),
  fromAddress: z.email(s.settings.invalidEmail),
  replyTo: z.email(s.settings.invalidEmail),
  hostRecipients: z
    .string()
    .transform((value) =>
      value
        .split(/[\s,;]+/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.email(s.settings.invalidEmails))
        .min(1, s.settings.invalidEmails)
        .max(10, s.settings.invalidEmails),
    ),
  hostLocale: z.enum(["en", "el"]),
  balanceReminderDays: whole(1, 60),
  preArrivalDays: whole(0, 60),
  thankYouDays: whole(0, 60),
  sendHour: whole(0, 23),
});

export async function saveEmailSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = settingsForm.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const stored = await loadEmailSettings(admin.supabase);
  const value = parseEmailSettings({
    ...stored,
    ...parsed.data,
    thankYouEnabled: formData.get("thankYouEnabled") === "on",
    calendarAttachment: formData.get("calendarAttachment") === "on",
  });

  const { error } = await admin.supabase.from("settings").upsert({
    key: "email",
    is_public: false,
    value: value as NonNullable<Json>,
  });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/email/settings");
  return okState(t.common.saved);
}

const templateForm = z.object({
  key: z.string().min(1),
  locale: z.enum(["en", "el"]),
  subject: z.string(),
  body: z.string(),
});

function describeProblem(problem: string): string {
  const texts = s.templates.problems;
  const [kind, name] = problem.split(":");
  if (kind === "unknown") return texts.unknown(name);
  if (kind === "missing") return texts.missing(name);
  return texts[kind as keyof typeof texts] as string;
}

const copyFrom = (value: { subject: string; body: string }): TemplateCopy => ({
  subject: value.subject.trim(),
  body: value.body.trim(),
});

export async function saveTemplate(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = templateForm.safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.common.somethingWrong);
  const { key, locale } = parsed.data;

  const def = findTemplate(key);
  if (!def?.editable) return errorState(t.common.somethingWrong);
  const copy = copyFrom(parsed.data);

  const problems = validateCopy(def, copy);
  if (problems.length) {
    return errorState(problems.map(describeProblem).join(" "));
  }

  const { error } = await admin.supabase
    .from("email_templates")
    .upsert({ key, locale, ...copy });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/email/templates", "layout");
  return okState(s.templates.saved);
}

export async function resetTemplate(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = templateForm
    .pick({ key: true, locale: true })
    .safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.common.somethingWrong);

  const { error } = await admin.supabase
    .from("email_templates")
    .delete()
    .eq("key", parsed.data.key)
    .eq("locale", parsed.data.locale);
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/email/templates", "layout");
  return okState(s.templates.resetDone);
}

export interface PreviewState {
  problems: string[];
  subject: string;
  html: string;
  text: string;
}

/** Uses the sample values only, so a preview holds no guest's data. */
export async function previewTemplate(
  previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await requireOwner();
  const parsed = templateForm.safeParse(formFields(formData));
  const def = parsed.success ? findTemplate(parsed.data.key) : undefined;
  if (!parsed.success || !def) return previous;

  const copy = copyFrom(parsed.data);
  const problems = validateCopy(def, copy);
  if (problems.length) {
    return { ...previous, problems: problems.map(describeProblem) };
  }
  const locale: EmailLocale = parsed.data.locale;
  const email = renderCopy(copy, {
    locale,
    values: def.sample[locale],
    brandName: "Casa Filakopi",
    footer: def.audience === "guest" ? ["host@example.com"] : [],
  });
  return { problems: [], ...email };
}

export async function retryEmail(formData: FormData): Promise<void> {
  const admin = await requireOwner();
  const id = z.uuid().parse(formData.get("id"));
  const db = await secretClient(admin);

  const { error } = await db
    .from("email_logs")
    .update({
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("status", "failed");
  if (error) throw error;

  await writeAudit(admin, {
    action: "retry",
    entity: "email_logs",
    entityId: id,
  });
  revalidatePath("/admin/email");
}

const ruleForm = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, t.validation.required).max(120),
  days: whole(0, 365),
  direction: z.enum(["before", "after"]),
  anchor: z.enum(["check_in", "check_out"]),
  subject_en: z.string().trim().min(1, t.validation.required).max(200),
  body_en: z.string().trim().min(1, t.validation.required).max(10_000),
  subject_el: z.string().trim().min(1, t.validation.required).max(200),
  body_el: z.string().trim().min(1, t.validation.required).max(10_000),
});

async function writeRules(
  admin: AdminContext,
  rules: ScheduledRule[],
): Promise<boolean> {
  const { error } = await admin.supabase.from("settings").upsert({
    key: SCHEDULED_RULES_KEY,
    is_public: false,
    value: rules as unknown as NonNullable<Json>,
  });
  if (error) return false;
  revalidatePath("/admin/email/scheduled");
  return true;
}

export async function saveRule(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = ruleForm.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const value = parsed.data;

  const rule: ScheduledRule = {
    id: value.id || randomUUID(),
    name: value.name,
    enabled: formData.get("enabled") === "on",
    anchor: value.anchor,
    offsetDays: value.direction === "before" ? -value.days : value.days,
    copy: {
      en: { subject: value.subject_en, body: value.body_en },
      el: { subject: value.subject_el, body: value.body_el },
    },
  };
  if (ruleTextProblems(rule).length) return errorState(s.scheduled.badText);

  const rules = await loadScheduledRules(admin.supabase);
  const known = rules.some((item) => item.id === rule.id);
  const next = known
    ? rules.map((item) => (item.id === rule.id ? rule : item))
    : [...rules, rule];

  return (await writeRules(admin, next))
    ? okState(t.common.saved)
    : errorState(t.common.somethingWrong);
}

export async function deleteRule(formData: FormData): Promise<void> {
  const admin = await requireOwner();
  const id = String(formData.get("id"));
  const rules = await loadScheduledRules(admin.supabase);
  await writeRules(
    admin,
    rules.filter((rule) => rule.id !== id),
  );
}

const oneOffForm = z.object({
  reference: z.string().trim().min(1, t.validation.required).max(40),
  date: z.iso.date(s.scheduled.badDate),
  subject: z.string().trim().min(1, t.validation.required).max(200),
  body: z.string().trim().min(1, t.validation.required).max(10_000),
});

export async function scheduleOneOff(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = oneOffForm.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { reference, date, subject, body } = parsed.data;

  const now = new Date();
  if (date < athensDate(now)) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { date: s.scheduled.badDate },
    };
  }
  if (validateText({ subject, body }, BOOKING_PLACEHOLDERS).length) {
    return errorState(s.scheduled.badText);
  }

  const { data: booking, error } = await admin.supabase
    .from("bookings")
    .select("id, guest_email")
    .eq("reference", reference)
    .maybeSingle();
  if (error) return errorState(t.common.somethingWrong);
  if (!booking) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { reference: s.scheduled.badReference },
    };
  }
  if (!booking.guest_email) return errorState(s.scheduled.noEmail);

  const db = await secretClient(admin);
  const { sendHour } = await loadEmailSettings(db);
  const sendAt = new Date(
    Math.max(athensInstant(date, sendHour).getTime(), now.getTime()),
  );
  const result = await queueEmailWith(
    db,
    "scheduled_message",
    { bookingId: booking.id, subject, body },
    { sendAt },
  );
  if (!result.ok) return errorState(t.common.somethingWrong);

  await writeAudit(admin, {
    action: "queue",
    entity: "email_logs",
    entityId: result.ids[0],
    after: { template_key: "scheduled_message", send_at: sendAt.toISOString() },
  });
  revalidatePath("/admin/email/scheduled");
  return okState(s.scheduled.queued);
}

export async function cancelScheduled(formData: FormData): Promise<void> {
  const admin = await requireOwner();
  const id = z.uuid().parse(formData.get("id"));
  const db = await secretClient(admin);

  const { error } = await db
    .from("email_logs")
    .update({
      status: "failed",
      last_error: `${SKIPPED_PREFIX} cancelled in Admin`,
    })
    .eq("id", id)
    .eq("status", "queued");
  if (error) throw error;

  await writeAudit(admin, {
    action: "cancel",
    entity: "email_logs",
    entityId: id,
  });
  revalidatePath("/admin/email/scheduled");
}
