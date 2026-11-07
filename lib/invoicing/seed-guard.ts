// Decides whether the demo data script may run. It writes documents that can
// never be deleted, so it only runs on purpose, and never near production.

const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

export interface SeedTarget {
  supabaseUrl: string;
  /** Anything that names the environment, such as VERCEL_ENV or NODE_ENV. */
  names: (string | undefined)[];
  /** The owner typed --staging for a project that is not local. */
  stagingFlag: boolean;
}

export const isLocalUrl = (url: string): boolean => LOCAL_URL.test(url);

/** Why the script must stop, or null when it may run. */
export function seedRefusal(target: SeedTarget): string | null {
  const { supabaseUrl, names, stagingFlag } = target;
  const named = [supabaseUrl, ...names].find(
    (value) => value && /prod/i.test(value),
  );
  if (named) return `Refusing to run: "${named}" looks like production.`;
  if (!supabaseUrl) return "Refusing to run: no Supabase address is set.";
  if (!isLocalUrl(supabaseUrl) && !stagingFlag) {
    return "Refusing to run: this is not a local database. Add --staging if it is staging.";
  }
  return null;
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
