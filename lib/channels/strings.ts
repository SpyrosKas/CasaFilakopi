import type { Channel, SyncErrorCode } from "./types";

// Every word of the Channel sync screens. Plain language for Yorgos.

const failureHelp =
  "Check the link still works. Until a sync succeeds, new bookings on that site will not reach this calendar.";

export const channelStrings = {
  title: "Channel sync",
  intro:
    "Keeps Airbnb, Booking.com and this website showing the same taken dates, so the house is not sold twice.",
  limitation: {
    heading: "This is close to live, not instant",
    body: "Calendars update every few minutes on our side, and Airbnb and Booking.com can take a few hours on theirs. If two guests book in that gap, the house can still be sold twice. We warn you here and by email when that happens.",
  },
  names: {
    airbnb: "Airbnb",
    booking_com: "Booking.com",
    other_ical: "Other calendar (such as Vrbo)",
  } satisfies Record<Channel, string>,
  general: {
    heading: "General",
    enabled: "Turn channel sync on",
    enabledHint:
      "When this is off we stop reading the other sites. Dates already taken stay taken, and the sites can still read our calendar.",
    channelsLegend: "Sites to read",
    intervalLegend: "How often to check",
    interval: (minutes: number) => `Every ${minutes} minutes`,
    holds: "Also show dates a guest is paying for right now",
    holdsHint:
      "Closes the dates on the other sites while a guest is at the payment page.",
    saved: "Saved.",
    save: "Save settings",
  },
  feed: {
    heading: (name: string) => name,
    urlLabel: "Link to their calendar",
    urlHint: "Paste the whole link. It starts with https://",
    saved: "Saved link:",
    none: "No link saved yet.",
    save: "Check and save link",
    saving: "Checking the link...",
    savedOk: (count: number) =>
      count === 1
        ? "The link works. It shows 1 stay or closed period."
        : `The link works. It shows ${count} stays or closed periods.`,
    remove: "Remove link",
    removing: "Removing...",
    removed:
      "Link removed. Dates already taken stay taken until you free them.",
    whereHeading: (name: string) => `Where do I find the link on ${name}?`,
    lastSync: "Last good sync:",
    never: "Never",
    failures: (count: number) => `${count} failed in a row`,
  },
  steps: {
    airbnb: [
      "Sign in to Airbnb and open your listing.",
      "Open Calendar, then Availability.",
      "Choose Connect calendars (it may say Sync calendars).",
      "Under Export calendar, copy the link and paste it here.",
    ],
    booking_com: [
      "Sign in to the Booking.com extranet.",
      "Open Rates & Availability, then Sync calendars.",
      "Choose Add calendar connection, then Export calendar.",
      "Copy the link and paste it here.",
    ],
    other_ical: [
      "Open the calendar settings of the other site.",
      "Look for Export, iCal or Sync calendar.",
      "Copy the link and paste it here.",
    ],
  } satisfies Record<Channel, string[]>,
  sync: {
    heading: "Sync now",
    all: "Sync everything now",
    one: (name: string) => `Sync ${name} now`,
    syncing: "Syncing...",
    done: (ran: number, conflicts: number) =>
      conflicts > 0
        ? `Synced ${ran}. Found ${conflicts} double booking${conflicts === 1 ? "" : "s"}.`
        : `Synced ${ran}.`,
    partFailed: (failed: number, ran: number) =>
      `${failed} of ${ran} could not be read. See the sync log below.`,
    nothing:
      "Nothing to sync. Check sync is on and a link is saved, or try again in a moment if a sync is already running.",
  },
  export: {
    heading: "Our calendar for the other sites",
    intro:
      "Each site needs its own link to our calendar, so it can close dates booked here or on the other sites. Guest names and details are never in it.",
    active: (date: string) => `Links created on ${date}.`,
    none: "No links created yet.",
    create: "Create links",
    creating: "Creating...",
    replaceHeading: "Replace the links",
    replaceWarning:
      "Use this only if a link was shared by mistake. The old links stop working at once, so you must paste the new ones into every site, or they stop seeing our dates.",
    replace: "Replace all links",
    showOnce:
      "Copy these now. For your safety we keep only a scrambled copy, so they cannot be shown again.",
    linkFor: (name: string) => `Link for ${name}`,
    howHeading: "How do I paste these in?",
    how: [
      "On Airbnb: Calendar, Availability, Connect calendars, Import calendar. Paste the Airbnb link and give it the name Casa Filakopi.",
      "On Booking.com: Rates & Availability, Sync calendars, Add calendar connection, Import calendar. Paste the Booking.com link.",
    ],
  },
  log: {
    heading: "Sync log",
    empty: "No syncs yet.",
    success: "Worked",
    failed: "Failed",
    running: "Running",
    events: (count: number) => (count === 1 ? "1 event" : `${count} events`),
  },
  alerts: {
    conflictHeading: (count: number) =>
      count === 1
        ? "Possible double booking"
        : `${count} possible double bookings`,
    conflictIntro:
      "Another site shows the house as taken on dates that are already taken. Check both bookings. Call the guest or cancel one as soon as you can. This message goes away by itself at the next sync once the dates no longer overlap.",
    conflictEcho:
      "If the dates match exactly and only one guest exists, it can be the same booking coming back from the other site. Then nothing is wrong.",
    conflictLine: (name: string, start: string, end: string) =>
      `${name}: ${start} to ${end}`,
    failing: (name: string, count: number) =>
      `${name} has failed ${count} times in a row. New bookings there are not reaching this calendar. Open Channel sync to check the link.`,
    stale: (name: string) =>
      `${name} has not synced for over 6 hours. Open Channel sync to check it.`,
    open: "Open Channel sync",
  },
  errors: {
    url: "That does not look like a web link. Paste the whole link, starting with https://",
    saveFailed: "The link works, but it could not be saved. Please try again.",
    missingRoom: "The house is missing, so nothing can be saved.",
    interval: "Please choose one of the times.",
  },
  failure: {
    bad_url:
      "That does not look like a web link. Paste the whole link, starting with https://",
    not_https: "The link must start with https://",
    blocked_address:
      "That link points to a private address, so it cannot be used. Copy the link from the site again.",
    timeout: `The site took too long to answer. ${failureHelp}`,
    too_large:
      "That calendar is far bigger than expected, so it was not used. Check it is the right link.",
    too_many_redirects:
      "That link sends us round in circles. Copy the link from the site again.",
    http_error: `The site said no. ${failureHelp}`,
    network_error: `We could not reach that site. ${failureHelp}`,
    malformed:
      "That link does not lead to a calendar. Copy the export link from the site again.",
    too_many_events:
      "That calendar has far more entries than expected, so it was not used. Check it is the right link.",
    storage_error: "We could not save the results. It will try again.",
    interrupted: "The sync stopped part-way. It will try again.",
  } satisfies Record<SyncErrorCode, string>,
};
