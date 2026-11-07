// Tap-to-call, tap-to-email and WhatsApp links. Each is null when the detail
// cannot make a working link, so no screen offers a button that goes nowhere.

const digitsOf = (phone: string) => phone.replace(/\D/g, "");

export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = digitsOf(phone);
  if (digits.length < 5) return null;
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${digits}`;
}

export function mailHref(email: string | null | undefined): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) return null;
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}`;
}

/**
 * WhatsApp needs the country code. A number written with + or 00 has one, and
 * a ten-digit number starting 69 is a Greek mobile. Anything else could reach
 * a stranger, so no link is offered.
 */
export function whatsappHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = digitsOf(trimmed);
  let international: string | null = null;
  if (trimmed.startsWith("+")) international = digits;
  else if (digits.startsWith("00")) international = digits.slice(2);
  else if (/^69\d{8}$/.test(digits)) international = `30${digits}`;
  if (!international || international.length < 8) return null;
  return `https://wa.me/${international}`;
}
