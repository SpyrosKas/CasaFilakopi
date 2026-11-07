import { z } from "zod";
import { MIN_HOLD_MINUTES, MIN_PASSWORD_LENGTH } from "@/lib/admin/config";
import { later } from "@/lib/admin/later";
import { parseBookingSettings } from "@/lib/domain/settings";

// Server-side validation for every admin form except the rules screen, which
// has its own file. Form values arrive as strings.

const v = later.admin.validation;

const trimmed = (max: number) => z.string().trim().max(max, v.tooLong);
const required = (max: number) => trimmed(max).min(1, v.required);
/** An empty box means nothing is stored. */
const optional = (max: number) =>
  trimmed(max).transform((value) => (value === "" ? null : value));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email(v.email).max(254, v.email));

const wholeNumber = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, message)
    .transform(Number)
    .pipe(z.int(message).min(min, message).max(max, message));

const webLink = z
  .string()
  .trim()
  .max(300, v.tooLong)
  .refine(
    (value) => value === "" || /^https:\/\/[^\s]+$/.test(value),
    v.webLink,
  );

const clockTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, v.time);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, v.required).max(200, v.tooLong),
});

export const forgotPasswordSchema = z.object({ email });

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, v.passwordLength(MIN_PASSWORD_LENGTH))
      .max(200, v.tooLong),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: v.passwordMatch,
  });

export const confirmLinkSchema = z.union([
  z.object({ code: z.string().min(1).max(500) }),
  z.object({
    tokenHash: z.string().min(1).max(500),
    type: z.enum(["recovery", "invite"]),
  }),
]);

const totpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, v.totpCode);

export const enrolConfirmSchema = z.object({
  factorId: z.uuid(),
  code: totpCode,
});

export const mfaVerifySchema = z.object({
  code: totpCode,
  // Only this value is accepted, so it cannot become an open redirect.
  next: z.enum(["password"]).optional(),
});

export const propertySchema = z.object({
  name: required(120),
  legal_name: optional(200),
  address: optional(300),
  phone: optional(40),
  email: z.union([z.literal(""), email]).transform((value) => value || null),
  registration_number: optional(60),
  check_in_time: clockTime,
  check_out_time: clockTime,
  instagram: webLink,
  facebook: webLink,
});

export const houseSchema = z
  .object({
    name_en: required(120),
    name_el: required(120),
    description_en: trimmed(4000),
    description_el: trimmed(4000),
    max_adults: wholeNumber(1, 30, v.adults),
    max_children: wholeNumber(0, 30, v.children),
    base_occupancy: wholeNumber(1, 60, v.baseGuests),
  })
  .refine(
    (value) => value.base_occupancy <= value.max_adults + value.max_children,
    { path: ["base_occupancy"], message: v.baseGuestsTooHigh },
  );

// lib/domain/settings.ts sets the limits that matter, such as the 31 minute
// hold. These upper limits only catch a slip of the finger.
export const bookingSettingsSchema = z.object({
  holdMinutes: wholeNumber(0, 240, v.holdMinutes(MIN_HOLD_MINUTES)),
  sameDayCutoffHour: wholeNumber(0, 24, v.cutoffHour),
  horizonMonths: wholeNumber(0, 36, v.horizonMonths),
  minStayNights: wholeNumber(0, 731, v.minStayNights),
  maxStayNights: wholeNumber(0, 731, v.maxStayNights),
});

const BOOKING_MESSAGES: Record<string, string> = {
  holdMinutes: v.holdMinutes(MIN_HOLD_MINUTES),
  sameDayCutoffHour: v.cutoffHour,
  horizonMonths: v.horizonMonths,
  minStayNights: v.minStayNights,
  maxStayNights: v.maxStayNights,
};

/**
 * Runs the whole stored setting through the domain's own check, so a save can
 * never leave something that would stop checkout. Null when it passes.
 */
export function bookingSettingsErrors(
  value: unknown,
): Record<string, string> | null {
  try {
    parseBookingSettings(value);
    return null;
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const errors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path[0]);
      errors[field] =
        BOOKING_MESSAGES[field] ?? later.admin.common.somethingWrong;
    }
    return errors;
  }
}
