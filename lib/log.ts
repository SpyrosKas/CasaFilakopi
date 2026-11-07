// Structured logs for routes and jobs (PLT-07), one JSON object per line, and
// optional error tracking (PLT-06).
//
// No personal data, by construction: a log line takes an event name and a few
// fields, and only numbers, booleans and short codes get through. Error text
// is kept out of Sentry completely, because a database or provider message can
// quote what a guest typed, and is masked in the server log.

export type LogFields = Record<string, unknown>;

/** A code, an id or a count. Anything with an @ or a space is not a code. */
const SAFE_TEXT = /^[A-Za-z0-9_.:/-]{1,80}$/;

const EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+/g;
const LONG_NUMBER = /\+?\d[\d\s()-]{6,}\d/g;

export function safeFields(fields: LogFields): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "string") {
      safe[key] = SAFE_TEXT.test(value) ? value : "[removed]";
    }
  }
  return safe;
}

export function maskText(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(LONG_NUMBER, "[number]")
    .slice(0, 300);
}

function write(level: "info" | "warn" | "error", line: LogFields) {
  const text = JSON.stringify({
    level,
    time: new Date().toISOString(),
    ...line,
  });
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export function logInfo(event: string, fields: LogFields = {}): void {
  write("info", { event, ...safeFields(fields) });
}

export function logWarn(event: string, fields: LogFields = {}): void {
  write("warn", { event, ...safeFields(fields) });
}

/** The name of an error says what failed. Its message may quote a guest. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? maskText(message) : "unknown";
}

interface Dsn {
  url: string;
  key: string;
}

/**
 * Only an EU-region project is accepted, so guest-facing errors cannot leave
 * the EU by a wrong setting. Anything else switches Sentry off.
 */
export function parseSentryDsn(value: string | undefined): Dsn | null {
  if (!value || !URL.canParse(value)) return null;
  const { protocol, username, hostname, pathname } = new URL(value);
  const project = pathname.replace(/^\//, "");
  if (protocol !== "https:" || !username || !/^\d+$/.test(project)) return null;
  if (!hostname.endsWith(".ingest.de.sentry.io")) return null;
  return {
    url: `https://${hostname}/api/${project}/envelope/`,
    key: username,
  };
}

/** The envelope Sentry takes. It carries no message and no stack. */
export function sentryEnvelope(
  event: string,
  errorType: string,
  fields: LogFields,
  now: Date,
): string {
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const body = JSON.stringify({
    event_id: eventId,
    timestamp: now.toISOString(),
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    logger: event,
    message: { formatted: event },
    fingerprint: [event],
    tags: { error_type: errorType.slice(0, 64) },
    extra: safeFields(fields),
  });
  return [
    JSON.stringify({ event_id: eventId }),
    JSON.stringify({ type: "event" }),
    body,
  ].join("\n");
}

async function sendToSentry(
  event: string,
  error: unknown,
  fields: LogFields,
): Promise<void> {
  const dsn = parseSentryDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  try {
    await fetch(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=casa-filakopi/1`,
      },
      body: sentryEnvelope(event, errorName(error), fields, new Date()),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Error tracking must never become the error.
  }
}

/** Await it in a route, or a serverless function may stop before it is sent. */
export async function logError(
  event: string,
  error: unknown,
  fields: LogFields = {},
): Promise<void> {
  write("error", {
    event,
    ...safeFields(fields),
    error: errorMessage(error),
  });
  await sendToSentry(event, error, fields);
}
