import { z } from "zod";
import type { EmailDb } from "./db";

// Stored in `settings` under the key `email`, so Yorgos can edit them (ADM-27).
// These are starting values (D27). Nothing needs a seed row: a missing key, or
// a whole missing row, reads as these defaults.

export const DEFAULT_HOST_RECIPIENT = "host@miloscasa.com";

const emailSettingsSchema = z.object({
  senderName: z.string().min(1).default("Casa Filakopi"),
  fromAddress: z.email().default("bookings@mail.miloscasa.com"),
  replyTo: z.email().default(DEFAULT_HOST_RECIPIENT),
  hostRecipients: z.array(z.email()).min(1).default([DEFAULT_HOST_RECIPIENT]),
  /** D25: the host works in Greek first. */
  hostLocale: z.enum(["en", "el"]).default("el"),
  /** The balance request goes on the booking's own due date. */
  balanceReminderDays: z.number().int().min(1).max(60).default(3),
  preArrivalDays: z.number().int().min(0).max(60).default(3),
  thankYouEnabled: z.boolean().default(false),
  thankYouDays: z.number().int().min(0).max(60).default(1),
  /** Hour on Milos before which timed emails wait. */
  sendHour: z.number().int().min(0).max(23).default(9),
  calendarAttachment: z.boolean().default(true),
  /**
   * Stays false until the accountant confirms (D17, D20). It is a second lock:
   * a provisional document is blocked whatever this says.
   */
  invoiceEmailEnabled: z.boolean().default(false),
});

export type EmailSettings = z.output<typeof emailSettingsSchema>;

export const DEFAULT_EMAIL_SETTINGS = emailSettingsSchema.parse({});

export function parseEmailSettings(value: unknown): EmailSettings {
  const parsed = emailSettingsSchema.safeParse(value ?? {});
  if (parsed.success) return parsed.data;
  // A bad setting must not stop guest emails.
  console.error(`email settings unreadable: ${parsed.error.message}`);
  return DEFAULT_EMAIL_SETTINGS;
}

export async function loadEmailSettings(db: EmailDb): Promise<EmailSettings> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", "email")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return parseEmailSettings(data?.value);
}

/** Read fresh each time: a stale "not provisional" would leak a document. */
export async function documentsAreProvisional(db: EmailDb): Promise<boolean> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", "invoicing")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = data?.value as { isProvisional?: unknown } | null | undefined;
  return value?.isProvisional !== false;
}
