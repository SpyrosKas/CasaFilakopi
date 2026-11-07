import { z } from "zod";
import { BOOKING_PLACEHOLDERS } from "@/emails/registry";
import type { IsoDate } from "@/lib/domain/contracts";
import {
  addDays,
  athensDate,
  athensHour,
  PROPERTY_TIME_ZONE,
} from "@/lib/domain/dates";
import type { EmailDb } from "./db";
import { queueEmailWith, type QueueResult } from "./queue";
import { loadEmailSettings, type EmailSettings } from "./settings";
import { validateText } from "./template-text";
import { asLocale, balanceDueOn, receivedCents } from "./variables";

// Timed emails (JOB-03, JOB-04, T5.8a). This job only decides and queues, and
// it decides by "is today on or past the date", so a day the cron missed is
// caught up. Each email's row id comes from booking + type, so running it twice
// or twice at once queues nothing new. All dates are dates on Milos.

const rulesKey = "scheduled_messages";

/** Days a rule keeps trying after its date. Stops a new rule mailing old stays. */
const RULE_CATCH_UP_DAYS = 2;
const THANK_YOU_CATCH_UP_DAYS = 14;

const copySchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
});

const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  anchor: z.enum(["check_in", "check_out"]),
  /** Negative is before the anchor date, positive after. */
  offsetDays: z.number().int().min(-365).max(365),
  copy: z.object({ en: copySchema, el: copySchema }),
});

export type ScheduledRule = z.output<typeof ruleSchema>;

export const ruleTextProblems = (rule: Pick<ScheduledRule, "copy">) => [
  ...validateText(rule.copy.en, BOOKING_PLACEHOLDERS),
  ...validateText(rule.copy.el, BOOKING_PLACEHOLDERS),
];

/** Stored in `settings`, so Yorgos edits them with no schema change. */
export async function loadScheduledRules(
  db: Pick<EmailDb, "from">,
): Promise<ScheduledRule[]> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", rulesKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const stored: unknown[] = Array.isArray(data?.value) ? data.value : [];
  // One bad rule must not silence the others.
  return stored.flatMap((value) => {
    const parsed = ruleSchema.safeParse(value);
    if (parsed.success) return [parsed.data];
    console.error(`scheduled rule unreadable: ${parsed.error.message}`);
    return [];
  });
}

export const SCHEDULED_RULES_KEY = rulesKey;

const offsetFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  timeZoneName: "longOffset",
});

/** The instant a given hour starts on Milos on a given date, DST included. */
export function athensInstant(date: IsoDate, hour: number): Date {
  const utcGuess = new Date(`${date}T12:00:00Z`);
  const zone = offsetFormat
    .formatToParts(utcGuess)
    .find((part) => part.type === "timeZoneName")!.value;
  const offset = zone.replace("GMT", "") || "+00:00";
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00${offset}`);
}

/** Today at the send hour, or now if that hour has gone. */
export function sendMoment(now: Date, settings: EmailSettings): Date {
  return athensHour(now) >= settings.sendHour
    ? now
    : athensInstant(athensDate(now), settings.sendHour);
}

export interface ScheduledResult {
  today: IsoDate;
  bookings: number;
  queued: number;
  alreadyQueued: number;
  failed: number;
}

async function loadStays(
  db: EmailDb,
  today: IsoDate,
  lookBackDays: number,
  onlyIds?: string[],
) {
  let query = db
    .from("bookings")
    .select(
      "id, status, source, locale, check_in, check_out, total_cents, price_breakdown, guest_email",
    )
    // OTA guests hear from the OTA, and a cancelled stay hears nothing.
    .in("status", ["confirmed", "checked_in", "completed"])
    .in("source", ["direct", "manual"])
    .not("guest_email", "is", null)
    .gte("check_out", addDays(today, -lookBackDays));
  if (onlyIds) query = query.in("id", onlyIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

type Stay = Awaited<ReturnType<typeof loadStays>>[number];

export async function sendScheduledEmails(
  db: EmailDb,
  now: Date,
  only?: { bookingIds: string[] },
): Promise<ScheduledResult> {
  const today = athensDate(now);
  const settings = await loadEmailSettings(db);
  const rules = (await loadScheduledRules(db)).filter((rule) => rule.enabled);
  const sendAt = sendMoment(now, settings);
  // The furthest back after check-out that anything could still be due.
  const lookBackDays = Math.max(
    settings.thankYouDays + THANK_YOU_CATCH_UP_DAYS,
    ...rules.map((rule) => Math.abs(rule.offsetDays) + RULE_CATCH_UP_DAYS),
  );
  const stays = await loadStays(db, today, lookBackDays, only?.bookingIds);

  const result: ScheduledResult = {
    today,
    bookings: stays.length,
    queued: 0,
    alreadyQueued: 0,
    failed: 0,
  };

  const tally = (outcome: QueueResult) => {
    if (!outcome.ok) result.failed += 1;
    else if (outcome.duplicate) result.alreadyQueued += 1;
    else result.queued += 1;
    return outcome;
  };

  for (const stay of stays) {
    const bookingId = stay.id;
    const upcoming = stay.status === "confirmed" && today < stay.check_in;

    if (upcoming) await queueBalance(db, stay, today, settings, sendAt, tally);

    const arrivalNotice = addDays(stay.check_in, -settings.preArrivalDays);
    const beforeArrival = stay.status === "confirmed" && today <= stay.check_in;
    if (beforeArrival && today >= arrivalNotice) {
      // Keyed by arrival date, so a moved stay gets the new dates (D28).
      tally(
        await queueEmailWith(
          db,
          "pre_arrival",
          { bookingId },
          { sendAt, dedupeKey: `pre_arrival:${bookingId}:${stay.check_in}` },
        ),
      );
    }

    if (settings.thankYouEnabled) {
      const from = addDays(stay.check_out, settings.thankYouDays);
      const until = addDays(from, THANK_YOU_CATCH_UP_DAYS);
      if (today >= from && today <= until) {
        tally(await queueEmailWith(db, "thank_you", { bookingId }, { sendAt }));
      }
    }

    for (const rule of rules) {
      const anchor =
        rule.anchor === "check_in" ? stay.check_in : stay.check_out;
      const target = addDays(anchor, rule.offsetDays);
      if (today < target || today > addDays(target, RULE_CATCH_UP_DAYS)) {
        continue;
      }
      const copy = rule.copy[asLocale(stay.locale)];
      tally(
        await queueEmailWith(
          db,
          "scheduled_message",
          {
            bookingId,
            subject: copy.subject,
            body: copy.body,
            ruleId: rule.id,
          },
          { sendAt, dedupeKey: `rule:${rule.id}:${bookingId}` },
        ),
      );
    }
  }
  return result;
}

async function requestPredates(
  db: EmailDb,
  bookingId: string,
  today: IsoDate,
): Promise<boolean> {
  const { data, error } = await db
    .from("email_logs")
    .select("created_at")
    .eq("booking_id", bookingId)
    .eq("template_key", "balance_request")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data && athensDate(new Date(data.created_at)) < today;
}

async function queueBalance(
  db: EmailDb,
  stay: Stay,
  today: IsoDate,
  settings: EmailSettings,
  sendAt: Date,
  tally: (outcome: QueueResult) => QueueResult,
): Promise<void> {
  const dueOn = balanceDueOn(stay);
  if (!dueOn || today < dueOn) return;
  if ((await receivedCents(db, stay.id)) >= stay.total_cents) return;

  const bookingId = stay.id;
  const request = tally(
    await queueEmailWith(db, "balance_request", { bookingId }, { sendAt }),
  );

  // A late run sends the request first. The reminder waits for a later day,
  // so a guest never gets both on one morning, however often this runs.
  const reminderDay = addDays(dueOn, settings.balanceReminderDays);
  if (
    request.ok &&
    request.duplicate &&
    today >= reminderDay &&
    (await requestPredates(db, bookingId, today))
  ) {
    tally(
      await queueEmailWith(db, "balance_reminder", { bookingId }, { sendAt }),
    );
  }
}
