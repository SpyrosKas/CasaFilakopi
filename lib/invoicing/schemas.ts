import { z } from "zod";
import { t } from "@/lib/admin/strings";
import { ISSUABLE_DOC_TYPES } from "./types";

// Server-side checks for the invoice forms. Form values arrive as strings.

const v = t.validation;
const i = t.invoices.errors;

const required = (max: number) =>
  z.string().trim().min(1, v.required).max(max, v.tooLong);
const optional = (max: number) => z.string().trim().max(max, v.tooLong);

/** Greek numbers are 9 digits. A foreign company's may hold letters. */
const vatNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{6,15}$/, i.vatNumber);

const company = z.object({
  companyName: required(200),
  vatNumber,
  address: required(300),
  taxOffice: required(120),
});

export const issueSchema = z.discriminatedUnion("docType", [
  z.object({ docType: z.literal("receipt"), paymentId: z.uuid() }),
  company.extend({ docType: z.literal("invoice"), paymentId: z.uuid() }),
]);

export const creditSchema = z.object({
  invoiceId: z.uuid(),
  amount: required(20),
  reason: required(500),
});

export const issuerFormSchema = z.object({
  legalName: required(200),
  vatNumber,
  taxOffice: required(120),
  address: required(300),
  phone: optional(40),
  email: z.union([
    z.literal(""),
    z.string().trim().toLowerCase().pipe(z.email(v.email).max(254, v.email)),
  ]),
  defaultDocType: z.enum(ISSUABLE_DOC_TYPES),
});
