import { z } from "zod";
import { ISSUABLE_DOC_TYPES, issuerSchema, type Issuer } from "./types";

// The `invoicing` setting. isProvisional is read here and never written from
// a form: it changes only after the accountant confirms the setup (D4).

export const invoicingSettingsSchema = z.looseObject({
  isProvisional: z.boolean().default(true),
  defaultDocType: z
    .enum(ISSUABLE_DOC_TYPES)
    .catch("receipt")
    .default("receipt"),
  myDataMode: z.string().default("off"),
  issuer: issuerSchema.default(() => issuerSchema.parse({})),
});

export type InvoicingSettings = z.output<typeof invoicingSettingsSchema>;

/** True while any detail is still empty or the placeholder from the seed. */
export function isDummyIssuer(issuer: Issuer): boolean {
  return (
    [issuer.legalName, issuer.taxOffice, issuer.address].some(
      (value) => value === "" || /dummy/i.test(value),
    ) || /^0*$/.test(issuer.vatNumber)
  );
}
