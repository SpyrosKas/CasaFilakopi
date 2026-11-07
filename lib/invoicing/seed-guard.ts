// Decides whether the demo data script may run. It writes documents that can
// never be deleted, so it only runs on purpose, and never near production.

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

/** The one hosted project demo data may go to. */
export const STAGING_PROJECT_REF = "iecsohriashrdbqcelkl";

export interface SeedTarget {
  supabaseUrl: string;
  /** Anything that names the environment, such as VERCEL_ENV or NODE_ENV. */
  names: (string | undefined)[];
  /** What the owner typed after --staging=, if anything. */
  stagingRef: string | undefined;
}

export const isLocalUrl = (url: string): boolean => LOCAL_URL.test(url);

/** The value of --staging=<ref>. A bare --staging gives an empty value. */
export function stagingRefFrom(args: string[]): string | undefined {
  const arg = args.find(
    (value) => value === "--staging" || value.startsWith("--staging="),
  );
  return arg?.slice("--staging=".length);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Why the script must stop, or null when it may run. */
export function seedRefusal(target: SeedTarget): string | null {
  const { supabaseUrl, names, stagingRef } = target;
  const named = [supabaseUrl, ...names].find(
    (value) => value && /prod/i.test(value),
  );
  if (named) return `Refusing to run: "${named}" looks like production.`;
  if (!supabaseUrl) return "Refusing to run: no Supabase address is set.";
  if (isLocalUrl(supabaseUrl)) return null;

  const isStaging =
    stagingRef === STAGING_PROJECT_REF &&
    hostOf(supabaseUrl) === `${STAGING_PROJECT_REF}.supabase.co`;
  return isStaging
    ? null
    : `Refusing to run: this is not a local database. For staging, point it at the staging project and add --staging=${STAGING_PROJECT_REF}.`;
}

/** The second check, once connected: only a provisional, dummy setup. */
export function setupRefusal(setup: {
  isStored: boolean;
  isProvisional: boolean;
  isDummy: boolean;
}): string | null {
  if (!setup.isStored) {
    return "Refusing to run: the invoicing setting is missing. Reset the database first.";
  }
  if (!setup.isProvisional) {
    return "Refusing to run: documents are no longer provisional here.";
  }
  if (!setup.isDummy) {
    return "Refusing to run: the issuer details here are real.";
  }
  return null;
}
