import { Tabs } from "@/components/admin/ui";
import { t } from "@/lib/admin/strings";

const LINKS = [
  { key: "calendar", href: "/admin/rates" },
  { key: "seasons", href: "/admin/rates/seasons" },
  { key: "restrictions", href: "/admin/rates/restrictions" },
  { key: "fees", href: "/admin/rates/fees" },
  { key: "promos", href: "/admin/rates/promos" },
] as const;

/** Staff reach stay rules only, so they see no tabs. */
export function RatesTabs({
  current,
  isOwner,
}: {
  current: (typeof LINKS)[number]["key"];
  isOwner: boolean;
}) {
  if (!isOwner) return null;
  return (
    <Tabs
      items={LINKS.map((link) => ({
        href: link.href,
        label: t.rates.tabs[link.key],
        active: link.key === current,
      }))}
    />
  );
}
