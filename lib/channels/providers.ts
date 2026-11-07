import { classifyEvent } from "./classify";
import { parseIcal } from "./ical-parser";
import { fetchFeed } from "./safe-fetch";
import type { ChannelProvider, PullResult } from "./types";

type Fetcher = (source: string) => ReturnType<typeof fetchFeed>;

/** Turns any text source into events. Tests give it their own fixtures. */
export function createIcalProvider(
  fetcher: Fetcher = fetchFeed,
): ChannelProvider {
  return {
    id: "ical",
    classify: classifyEvent,
    async pull(source, today): Promise<PullResult> {
      const fetched = await fetcher(source);
      if (!fetched.ok) return fetched;
      const parsed = parseIcal(fetched.text, today);
      if (!parsed.ok) return parsed;
      return { ok: true, events: parsed.events, unreadable: parsed.unreadable };
    },
  };
}

/** The one place a channel manager such as Beds24 would be chosen instead. */
export function defaultProvider(): ChannelProvider {
  return createIcalProvider();
}
