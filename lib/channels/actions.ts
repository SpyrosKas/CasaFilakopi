"use server";

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
import { t } from "@/lib/admin/strings";
import { createAdminClient } from "@/lib/db/admin";
import { athensDate } from "@/lib/domain/dates";
import { getPublicEnv } from "@/lib/env";
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
import { createChannelStore } from "./store";
import { channelStrings as s } from "./strings";
import { syncNow } from "./sync";
import { CHANNELS, type Channel } from "./types";

const PATH = "/admin/integrations";
const SYNC_BUDGET_MS = 40_000;

/** The secret key skips the MFA test in RLS, so ask the database first. */
async function assertOwnerRole(admin: AdminContext): Promise<void> {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error || role !== "owner") throw new Error("not_authorised");
}

export async function saveGeneral(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = generalSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { enabled, airbnb, booking_com, other_ical, exportHolds } = parsed.data;

  const { error } = await admin.supabase.from("settings").upsert({
    key: SETTINGS_KEY,
    is_public: false,
    value: {
      enabled,
      channels: { airbnb, booking_com, other_ical },
      intervalMinutes: parsed.data.intervalMinutes,
      exportHolds,
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
  const admin = await requireOwner();
  const parsed = feedSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { roomId, channel, url } = parsed.data;

  const pulled = await defaultProvider().pull(url, athensDate(new Date()));
  if (!pulled.ok) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { url: s.failure[pulled.code] },
    };
  }

  // Through the Owner's client: RLS allows this table for Owners only.
  const { error } = await admin.supabase.from("external_calendars").upsert(
    {
      room_id: roomId,
      channel,
      import_url: url,
      is_enabled: true,
      consecutive_failures: 0,
    },
    { onConflict: "room_id,channel" },
  );
  if (error) return errorState(s.errors.saveFailed);

  // Says which link changed, never what it is.
  await writeAudit(admin, {
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
  const admin = await requireOwner();
  const parsed = removeFeedSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const { error } = await admin.supabase
    .from("external_calendars")
    .update({ import_url: null, is_enabled: false, consecutive_failures: 0 })
    .eq("room_id", parsed.data.roomId)
    .eq("channel", parsed.data.channel);
  if (error) return errorState(t.common.somethingWrong);

  await writeAudit(admin, {
    action: "ical_import_link_removed",
    entity: "external_calendars",
    entityId: parsed.data.roomId,
    after: { channel: parsed.data.channel },
  });

  revalidatePath(PATH);
  return okState(s.feed.removed);
}

export async function runSyncNow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = syncNowSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

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
  const admin = await requireOwner();
  const parsed = tokenSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const token = createExportToken();
  try {
    await assertOwnerRole(admin);
    await writeToken(parsed.data.roomId, token);
    await writeAudit(admin, {
      action: "ical_export_token_rotated",
      entity: "ical_export_tokens",
      entityId: parsed.data.roomId,
    });
  } catch {
    return errorState(t.common.somethingWrong);
  }

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
