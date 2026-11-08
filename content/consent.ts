/** Bump when the cookie policy changes: everyone is asked again. */
export const COOKIE_POLICY_VERSION = "draft-1";

/** Ask again after six months, as most EU regulators advise. */
export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export const CONSENT_STORAGE_KEY = "casa-filakopi-cookie-consent";

export type ConsentChoice = "accepted" | "declined";

export type StoredConsent = {
  choice: ConsentChoice;
  /** Random id so a later withdrawal links to the same record. Not personal. */
  id: string;
  version: string;
  at: number;
};
