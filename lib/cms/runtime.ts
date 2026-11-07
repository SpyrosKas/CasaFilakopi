// What a failed content read does.
//
// While building, there is no earlier page to fall back on, so the built-in
// copy is used and the hourly revalidate replaces it. A build therefore never
// depends on the database.
//
// While running, the read throws. A background regeneration that throws leaves
// the last good page in place, so visitors never get old built-in text in
// place of what Yorgos published.

export const isBuilding = () =>
  process.env.NEXT_PHASE === "phase-production-build";

export function recover<T>(what: string, error: unknown, fallback: () => T): T {
  if (!isBuilding()) throw error;
  console.error(
    `Building with built-in content: ${what} could not be read.`,
    error instanceof Error ? error.message : error,
  );
  return fallback();
}
