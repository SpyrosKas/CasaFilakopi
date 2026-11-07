import { adminI18n } from "@/lib/admin/i18n-server";
import { ChannelAlertsPanel } from "@/components/admin/integrations/channel-alerts";
import { ExportLinks } from "@/components/admin/integrations/export-links";
import {
  FeedCard,
  SyncButton,
} from "@/components/admin/integrations/feed-card";
import { GeneralForm } from "@/components/admin/integrations/general-form";
import { SyncLog } from "@/components/admin/integrations/sync-log";
import { requireOwner } from "@/lib/admin/session";
import { loadHouse } from "@/lib/admin/settings-data";
import { loadIntegrations } from "@/lib/channels/data";

// Sync now runs inside this page's server action.
export const maxDuration = 60;

export default async function IntegrationsPage() {
  const { channels: s } = await adminI18n();

  const admin = await requireOwner();
  const house = await loadHouse(admin);

  if (!house) {
    return (
      <div className="stack">
        <h1>{s.title}</h1>
        <p className="notice notice-bad">{s.errors.missingRoom}</p>
      </div>
    );
  }

  const data = await loadIntegrations(admin, house.id);

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <div className="notice notice-info">
        <strong>{s.limitation.heading}</strong>
        <p>{s.limitation.body}</p>
      </div>
      <ChannelAlertsPanel />
      <h2>{s.general.heading}</h2>
      <GeneralForm settings={data.settings} />
      {data.feeds.map((feed) => (
        <FeedCard key={feed.channel} roomId={data.roomId} feed={feed} />
      ))}
      {data.feeds.some((feed) => feed.isActive) && (
        <SyncButton label={s.sync.all} />
      )}
      <ExportLinks roomId={data.roomId} createdAt={data.exportCreatedAt} />
      <SyncLog rows={data.log} />
    </div>
  );
}
