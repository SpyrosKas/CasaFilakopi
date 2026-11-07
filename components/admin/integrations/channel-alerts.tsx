import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { loadChannelAlerts, type FeedAlert } from "@/lib/channels/data";

/**
 * Double bookings and failing feeds. On the home page and the Channel sync
 * screen. A problem here must not take the home page down with it.
 */
export async function ChannelAlertsPanel({
  withLink = false,
}: {
  withLink?: boolean;
}) {
  const {
    channels: s,
    formatYearDate: formatStayDate,
    formatStamp: formatMoment,
  } = await adminI18n();

  const alerts = await loadChannelAlerts().catch(() => null);
  if (!alerts) {
    return (
      <p className="notice notice-bad" role="alert">
        {s.alerts.loadFailed}
      </p>
    );
  }
  const { conflicts, feeds, releases } = alerts;
  const general = [
    alerts.settingsDamaged && s.alerts.settingsDamaged,
    alerts.syncOff && !alerts.settingsDamaged && s.alerts.syncOff,
    alerts.noNotificationEmail && s.alerts.noEmail,
    alerts.automaticSyncMissing && s.alerts.automaticSyncMissing,
  ].filter((line) => typeof line === "string");

  if (
    general.length === 0 &&
    conflicts.length === 0 &&
    feeds.length === 0 &&
    releases.length === 0
  ) {
    return null;
  }

  const feedLine = (feed: FeedAlert) => {
    const name = s.names[feed.channel];
    if (feed.health === "unreadable") {
      return s.alerts.unreadable(name, feed.unreadable);
    }
    return feed.health === "failing"
      ? s.alerts.failing(name, feed.failures)
      : s.alerts.stale(name, alerts.staleHours);
  };

  return (
    <div className="stack" data-testid="channel-alerts">
      {general.map((line) => (
        <p key={line} className="notice notice-bad" role="alert">
          {line}
        </p>
      ))}
      {conflicts.length > 0 && (
        <div className="notice notice-bad stack" role="alert">
          <strong>{s.alerts.conflictHeading(conflicts.length)}</strong>
          <p>{s.alerts.conflictIntro}</p>
          <ul>
            {conflicts.map((conflict) => (
              <li key={conflict.id}>
                {s.alerts.conflictLine(
                  s.names[conflict.channel],
                  formatStayDate(conflict.start),
                  formatStayDate(conflict.end),
                )}
              </li>
            ))}
          </ul>
          <p>{s.alerts.conflictEcho}</p>
        </div>
      )}
      {feeds.map((feed) => (
        <p key={feed.channel} className="notice notice-bad" role="alert">
          {feedLine(feed)}
        </p>
      ))}
      {releases.map((release) => (
        <p key={release.at} className="notice notice-info" role="status">
          {s.alerts.released(
            s.names[release.channel],
            release.count,
            formatMoment(release.at),
          )}
        </p>
      ))}
      {withLink && (
        <Link href="/admin/integrations" prefetch={false} className="text-link">
          {s.alerts.open}
        </Link>
      )}
    </div>
  );
}
