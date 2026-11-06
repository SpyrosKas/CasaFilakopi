/** Bump when the cookie policy changes: everyone is asked again. */
export const COOKIE_POLICY_VERSION = "draft-1";

export const CONSENT_STORAGE_KEY = "casa-milos-cookie-consent";

export type ConsentChoice = "accepted" | "declined";

export type StoredConsent = {
  choice: ConsentChoice;
  /** Random id so a later withdrawal links to the same record. Not personal. */
  id: string;
  version: string;
  at: number;
};
