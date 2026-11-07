import { z } from "zod";
import { channelStrings as s } from "./strings";
import { SYNC_INTERVALS } from "./settings";
import { CHANNELS } from "./types";

const checkbox = z
  .literal("on")
  .optional()
  .transform((value) => value === "on");

export const generalSchema = z.object({
  enabled: checkbox,
  airbnb: checkbox,
  booking_com: checkbox,
  other_ical: checkbox,
  intervalMinutes: z.coerce
    .number()
    .pipe(z.literal(SYNC_INTERVALS, { error: s.errors.interval })),
});

export const feedSchema = z.object({
  roomId: z.uuid(),
  channel: z.enum(CHANNELS),
  url: z.string().trim().min(1, s.errors.url).max(2_048, s.errors.url),
});

export const removeFeedSchema = feedSchema.omit({ url: true });

export const syncNowSchema = z.object({
  channel: z.enum(CHANNELS).optional(),
});

export const tokenSchema = z.object({ roomId: z.uuid() });
