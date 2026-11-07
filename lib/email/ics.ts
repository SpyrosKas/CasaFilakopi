import { addDays } from "@/lib/domain/dates";

// A calendar file for the confirmation email (EML-09). All-day dates, so the
// stay shows on the right days wherever the guest's phone happens to be.

const compact = (date: string) => date.replaceAll("-", "");

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n?|\n/g, "\\n");

/** RFC 5545: lines over 75 bytes continue on the next line after a space. */
function fold(line: string): string {
  const chunks: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = Buffer.byteLength(char);
    if (size + width > 73) {
      chunks.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

export interface StayEvent {
  uid: string;
  title: string;
  location?: string | null;
  checkIn: string;
  checkOut: string;
  createdAt: Date;
}

export function buildStayIcs(event: StayEvent): string {
  const stamp = event.createdAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Casa Filakopi//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@miloscasa.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(event.checkIn)}`,
    // DTEND is exclusive, and the guest is still there on check-out morning.
    `DTEND;VALUE=DATE:${compact(addDays(event.checkOut, 1))}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
