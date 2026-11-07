import { PROPERTY_TIME_ZONE } from "@/lib/domain/dates";

/** "1 Jun 2027". The date stays as stored, whatever the server's zone. */
export function formatStayDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "1 Jun 2027, 14:05" on Milos. */
export function formatMoment(instant: string): string {
  return new Date(instant).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PROPERTY_TIME_ZONE,
  });
}
