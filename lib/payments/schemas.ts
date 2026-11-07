import { z } from "zod";
import { isValidIsoDate } from "@/lib/domain/dates";

// What a browser may send. Shared by the routes and the forms. Each object is
// strict, so an amount sent from the browser is refused, not ignored (BKG-06).

const date = z.string().refine(isValidIsoDate);
const guests = {
  adults: z.number().int().min(1).max(30),
  children: z.number().int().min(0).max(30),
};
const locale = z.enum(["en", "el"]);
const promoCode = z.string().trim().max(40).optional();

export const quoteSchema = z.strictObject({
  checkIn: date,
  checkOut: date,
  ...guests,
  promoCode,
  locale,
});

export type QuoteRequest = z.output<typeof quoteSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined);

export const checkoutSchema = z.strictObject({
  checkIn: date,
  checkOut: date,
  ...guests,
  promoCode,
  locale,
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: z
    .string()
    .trim()
    .regex(/^[+()\d][\d\s()./-]{4,38}$/),
  country: z.string().trim().min(2).max(60),
  arrivalTime: z
    .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
    .optional()
    .transform((value) => value || undefined),
  specialRequests: optionalText(2000),
  marketing: z.boolean(),
  acceptTerms: z.literal(true),
});

export type CheckoutRequest = z.output<typeof checkoutSchema>;

export const guestTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export const balanceSchema = z.strictObject({
  token: guestTokenSchema,
  locale,
});

export const guestCancelSchema = z.strictObject({
  token: guestTokenSchema,
  expectedRefundCents: z.number().int().min(0),
});

export const guestMessageSchema = z.strictObject({
  token: guestTokenSchema,
  message: z.string().trim().min(2).max(4000),
  cancelRequest: z.boolean().default(false),
});

export const releaseSchema = z.strictObject({
  key: z.string().max(200),
});

export const sessionIdSchema = z
  .string()
  .max(255)
  .regex(/^cs_[A-Za-z0-9_]+$/);
