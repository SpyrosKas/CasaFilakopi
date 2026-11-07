import Link from "next/link";
import { formatStayDate } from "@/components/admin/integrations/format";
import type { AdminContext } from "@/lib/admin/session";
import { loadChannelAlerts } from "@/lib/channels/data";
import { channelStrings as s } from "@/lib/channels/strings";

/**
 * Double bookings and failing feeds. On the home page and the Channel sync
 * screen. A problem here must not take the home page down with it.
 */
export async function ChannelAlertsPanel({
  admin,
  withLink = false,
}: {
  admin: AdminContext;
  withLink?: boolean;
}) {
  const alerts = await loadChannelAlerts(admin).catch(() => null);
  if (!alerts) return null;
  const { conflicts, feeds } = alerts;
  if (conflicts.length === 0 && feeds.length === 0) return null;

  return (
    <div className="stack" data-testid="channel-alerts">
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
          {feed.health === "failing"
            ? s.alerts.failing(s.names[feed.channel], feed.failures)
            : s.alerts.stale(s.names[feed.channel])}
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
