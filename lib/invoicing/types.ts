import { z } from "zod";

// Shapes of what the database stores for a document. Issued documents never
// change, and older ones may hold fewer keys, so reading a stored document is
// forgiving: a missing detail shows as empty and never hides the document.

export const ISSUABLE_DOC_TYPES = ["receipt", "invoice"] as const;
export const DOC_TYPES = [...ISSUABLE_DOC_TYPES, "credit_note"] as const;
export type IssuableDocType = (typeof ISSUABLE_DOC_TYPES)[number];
export type DocType = (typeof DOC_TYPES)[number];

export const PAYMENT_METHODS = [
  "card",
  "cash",
  "bank_transfer",
  "pos",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentKind = "full" | "deposit" | "balance" | "extra";

/** The kinds invoice_lines accepts. A fee is outside the VAT base. */
export type LineKind =
  | "accommodation"
  | "extra_guest"
  | "cleaning"
  | "fee"
  | "discount"
  | "deposit"
  | "balance"
  | "other";

/** What write_invoice_lines reads. totalCents includes vatCents. */
export interface DocumentLine {
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  vatCents: number;
  vatBasisPoints: number;
  kind: LineKind;
}

const text = z.string().catch("");

export const issuerSchema = z.looseObject({
  legalName: text.default(""),
  vatNumber: text.default(""),
  taxOffice: text.default(""),
  address: text.default(""),
  phone: text.default(""),
  email: text.default(""),
});
export type Issuer = z.output<typeof issuerSchema>;

export const customerSchema = z.looseObject({
  name: text.default(""),
  email: text.default(""),
  country: text.default(""),
  companyName: text.default(""),
  vatNumber: text.default(""),
  address: text.default(""),
  taxOffice: text.default(""),
});
export type Customer = z.output<typeof customerSchema>;

export const parseIssuer = (value: unknown): Issuer =>
  issuerSchema.safeParse(value).data ?? issuerSchema.parse({});

export const parseCustomer = (value: unknown): Customer =>
  customerSchema.safeParse(value).data ?? customerSchema.parse({});

/** The name to show for a document: the company when there is one. */
export const customerLabel = (customer: Customer, fallback = ""): string =>
  customer.companyName || customer.name || fallback;
