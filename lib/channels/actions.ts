"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import { athensDate } from "@/lib/domain/dates";
import { getPublicEnv } from "@/lib/env";
import { sendSentryTest } from "@/lib/log";
import { createExportToken, exportFileName, hashExportToken } from "./export";
import { defaultProvider } from "./providers";
import {
  feedSchema,
  generalSchema,
  removeFeedSchema,
  syncNowSchema,
  tokenSchema,
} from "./schemas";
import { SETTINGS_KEY } from "./settings";
import { isOwnSite } from "./safe-url";
import { createChannelStore, saveFeedLink } from "./store";
import { syncNow } from "./sync";
import { CHANNELS, type Channel } from "./types";

const PATH = "/admin/integrations";
const SYNC_BUDGET_MS = 40_000;

/** The secret key skips the MFA test in RLS, so ask the database first. */
async function assertOwnerRole(admin: AdminContext): Promise<void> {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error || role !== "owner") throw new Error("not_authorised");
}

/** The change has already happened, so a failed log entry must not undo that. */
async function auditQuietly(
  admin: AdminContext,
  entry: Parameters<typeof writeAudit>[1],
): Promise<void> {
  try {
    await writeAudit(admin, entry);
  } catch {
    console.error("channels: could not write an audit entry");
  }
}

export async function saveGeneral(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t, channels: s } = await adminI18n();

  const admin = await requireOwner();
  const parsed = generalSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { enabled, airbnb, booking_com, other_ical } = parsed.data;

  if (enabled) {
    const { data, error } = await admin.supabase
      .from("property")
      .select("email")
      .maybeSingle();
    if (error) return errorState(t.common.somethingWrong);
    if (!data?.email) return errorState(s.errors.needsEmail);
  }

  const { error } = await admin.supabase.from("settings").upsert({
    key: SETTINGS_KEY,
    is_public: false,
    value: {
      enabled,
      channels: { airbnb, booking_com, other_ical },
      intervalMinutes: parsed.data.intervalMinutes,
      // Stays off until real feeds are checked (D28).
      exportHolds: false,
    },
  });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath(PATH);
  return okState(s.general.saved);
}

/** Fetches the link before keeping it (CHN-05). */
export async function saveFeed(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t, channels: s } = await adminI18n();

  const admin = await requireOwner();
  const parsed = feedSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { roomId, channel, url } = parsed.data;

  if (isOwnSite(url, getPublicEnv().NEXT_PUBLIC_SITE_URL)) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { url: s.errors.ownSite },
    };
  }

  const pulled = await defaultProvider().pull(url, athensDate(new Date()));
  if (!pulled.ok) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { url: s.failure[pulled.code] },
    };
  }

  // With the secret key: signed-in sessions cannot touch this column at all.
  try {
    await assertOwnerRole(admin);
    await saveFeedLink(createAdminClient(), { roomId, channel, url });
  } catch {
    return errorState(s.errors.saveFailed);
  }

  // Says which link changed, never what it is.
  await auditQuietly(admin, {
    action: "ical_import_link_saved",
    entity: "external_calendars",
    entityId: roomId,
    after: { channel },
  });

  revalidatePath(PATH);
  return okState(s.feed.savedOk(pulled.events.length));
}

export async function removeFeed(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t, channels: s } = await adminI18n();

  const admin = await requireOwner();
  const parsed = removeFeedSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  try {
    await assertOwnerRole(admin);
  } catch {
    return errorState(t.common.somethingWrong);
  }
  const { error } = await createAdminClient()
    .from("external_calendars")
    .update({ import_url: null, is_enabled: false, consecutive_failures: 0 })
    .eq("room_id", parsed.data.roomId)
    .eq("channel", parsed.data.channel);
  if (error) return errorState(t.common.somethingWrong);

  await auditQuietly(admin, {
    action: "ical_import_link_removed",
    entity: "external_calendars",
    entityId: parsed.data.roomId,
    after: { channel: parsed.data.channel },
  });

  revalidatePath(PATH);
  return okState(s.feed.removed);
}

/**
 * Frees the future stays of a site whose link has been removed. Nothing else
 * will: with no link there are no more syncs. Started stays are kept.
 */
export async function freeFeedDates(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, channels: s, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = removeFeedSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  let freed: number;
  try {
    await assertOwnerRole(admin);
    const db = createAdminClient();
    const { data, error } = await db
      .from("external_calendars")
      .select("id, import_url")
      .eq("room_id", parsed.data.roomId)
      .eq("channel", parsed.data.channel)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.import_url) return errorState(s.errors.linkStillSaved);

    const store = createChannelStore(db);
    const started = await store.startedUids(data.id, athensDate(new Date()));
    freed = await store.releaseMissing(data.id, started, true);
  } catch {
    return errorState(t.common.somethingWrong);
  }

  await auditQuietly(admin, {
    action: "channel_dates_freed",
    entity: "external_calendars",
    entityId: parsed.data.roomId,
    after: { channel: parsed.data.channel, count: freed },
  });

  revalidatePath(PATH);
  revalidatePath("/admin");
  return okState(s.feed.freed(freed));
}

export async function runSyncNow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t, channels: s } = await adminI18n();

  const admin = await requireOwner();
  const parsed = syncNowSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  let report;
  try {
    await assertOwnerRole(admin);
    report = await syncNow(
      {
        store: createChannelStore(createAdminClient()),
        provider: defaultProvider(),
      },
      SYNC_BUDGET_MS,
      parsed.data.channel,
    );
  } catch {
    return errorState(t.common.somethingWrong);
  }

  revalidatePath(PATH);
  if (report.ran === 0) return errorState(s.sync.nothing);
  if (report.failed > 0) {
    return errorState(s.sync.partFailed(report.failed, report.ran));
  }
  if (report.partial > 0) return errorState(s.sync.partial);
  return okState(s.sync.done(report.ran, report.newConflicts));
}

export interface ExportLink {
  channel: Channel;
  url: string;
}

export interface ExportState extends ActionState {
  links?: ExportLink[];
}

async function writeToken(roomId: string, token: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("ical_export_tokens")
    .upsert({
      room_id: roomId,
      token_hash: hashExportToken(token),
      rotated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

/** Creates or replaces the links. The old ones stop working at once (CHN-12). */
export async function regenerateExport(
  _previous: ExportState,
  formData: FormData,
): Promise<ExportState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = tokenSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const token = createExportToken();
  try {
    await assertOwnerRole(admin);
    await writeToken(parsed.data.roomId, token);
  } catch {
    return errorState(t.common.somethingWrong);
  }

  // The old links are already dead, so these must reach Yorgos whatever happens.
  await auditQuietly(admin, {
    action: "ical_export_token_rotated",
    entity: "ical_export_tokens",
    entityId: parsed.data.roomId,
  });

  const site = getPublicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  revalidatePath(PATH);
  return {
    status: "ok",
    links: CHANNELS.map((channel) => ({
      channel,
      url: `${site}/api/ical/${exportFileName(channel, token)}`,
    })),
  };
}

/** The Owner's check that error alerts reach Sentry. Sends no guest data. */
export async function sendTestAlert(): Promise<ActionState> {
  const { channels: s } = await adminI18n();
  await requireOwner();
  return (await sendSentryTest())
    ? okState(s.monitoring.sent)
    : errorState(s.monitoring.failed);
}
