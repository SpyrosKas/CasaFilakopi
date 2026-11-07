import type { Channel, SyncErrorCode } from "./types";

// Every English word of the Channel sync screens. Plain language for Yorgos.
// The Greek is in strings.el.ts, typed against this object.

const failureHelp =
  "Check the link still works. Until a sync succeeds, new bookings on that site will not reach this calendar.";

export const channelsEn = {
  title: "Channel sync",
  intro:
    "Keeps Airbnb, Booking.com and this website showing the same taken dates, so the house is not sold twice.",
  limitation: {
    heading: "This is close to live, not instant",
    body: "Calendars update every few minutes on our side, and Airbnb and Booking.com can take a few hours on theirs. If two guests book in that gap, the house can still be sold twice. Warnings appear on this screen and on the home page. Email warnings start once sending email has been connected, so check here for now.",
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
      "Stays off for now. We will turn it on only after checking it against the real Airbnb and Booking.com calendars.",
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
      "Link removed. Dates from this site stay closed. If they are no longer real, you can free them below.",
    freeHeading: (count: number) =>
      count === 1
        ? "Free 1 stay from this site"
        : `Free ${count} stays from this site`,
    freeWarning:
      "Do this only if these stays are really gone. The dates open for booking straight away. A stay that has already started is kept.",
    free: "Free these dates",
    freeing: "Freeing...",
    freed: (count: number) =>
      count === 1 ? "1 stay was freed." : `${count} stays were freed.`,
    whereHeading: (name: string) => `Where do I find the link on ${name}?`,
    lastSync: "Last read:",
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
    partial:
      "Some entries could not be read, so nothing was freed. See the sync log below.",
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
    copy: "Copy link",
    copied: "Copied",
    copyFailed: "Could not copy. Press and hold the link to copy it.",
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
    released: (count: number) =>
      count === 1
        ? "1 future stay was freed."
        : `${count} future stays were freed.`,
    unreadable: (count: number) =>
      count === 1
        ? "1 entry could not be read, so nothing was freed."
        : `${count} entries could not be read, so nothing was freed.`,
    echoed: (count: number) =>
      count === 1
        ? "1 stay has the exact dates of one of ours, so it looks like our own calendar coming back. No alarm raised."
        : `${count} stays have the exact dates of ours, so they look like our own calendar coming back. No alarm raised.`,
    alertUnsent: "A warning could not be queued.",
  },
  alerts: {
    loadFailed:
      "Channel sync warnings could not be loaded. Open Channel sync to check it.",
    conflictHeading: (count: number) =>
      count === 1
        ? "Possible double booking"
        : `${count} possible double bookings`,
    syncOff:
      "Channel sync is off. Bookings on Airbnb and Booking.com are not reaching this calendar, so the house can be sold twice.",
    settingsDamaged:
      "The channel sync settings could not be read, so sync is off. Open Channel sync and save the settings again.",
    noEmail:
      "No notification email is set, so warnings cannot be queued for you. Add one in Property details. Until then, check this page.",
    automaticSyncMissing:
      "The automatic sync has not run. Calendars are only updating when someone presses Sync now.",
    unreadable: (name: string, count: number) =>
      `${count === 1 ? "1 entry" : `${count} entries`} in the ${name} calendar could not be read. Those dates may not be closed here, so check that calendar by hand. Until every entry can be read, we free nothing from ${name}, even if a guest cancels there.`,
    released: (name: string, count: number, at: string) =>
      `${name} no longer shows ${count === 1 ? "1 future stay" : `${count} future stays`}, so those dates were opened on ${at}. If that looks wrong, check ${name} at once.`,
    conflictIntro:
      "Another site shows the house as taken on dates that are already taken. Check both bookings. Call the guest or cancel one as soon as you can. This message goes away by itself at the next sync once the dates no longer overlap.",
    conflictEcho:
      "If the dates match exactly and only one guest exists, it can be the same booking coming back from the other site. Then nothing is wrong.",
    conflictLine: (name: string, start: string, end: string) =>
      `${name}: ${start} to ${end}`,
    failing: (name: string, count: number) =>
      `${name} has failed ${count} times in a row. New bookings there are not reaching this calendar. Open Channel sync to check the link.`,
    stale: (name: string, hours: number) =>
      `${name} has not synced for over ${hours} hours. Open Channel sync to check it.`,
    open: "Open Channel sync",
  },
  mail: {
    stale: (hours: number) => `No good sync for over ${hours} hours.`,
    unreadable: (count: number) =>
      `${count === 1 ? "1 entry" : `${count} entries`} could not be read, so those dates may not be closed here and nothing is being freed.`,
    released: (count: number) =>
      `The site no longer shows ${count === 1 ? "1 future stay" : `${count} future stays`}, so those dates were opened. Check this is right.`,
  },
  errors: {
    url: "That does not look like a web link. Paste the whole link, starting with https://",
    saveFailed: "The link works, but it could not be saved. Please try again.",
    missingRoom: "The house is missing, so nothing can be saved.",
    needsEmail:
      "Channel sync needs a notification email first, so warnings have somewhere to go. Add one in Property details, then come back.",
    ownSite:
      "That is this website's own link. Paste the link from the other site instead.",
    linkStillSaved: "Remove the link first.",
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

export type ChannelStrings = typeof channelsEn;
