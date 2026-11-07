import { BOOKING_PLACEHOLDERS, GUEST_TEMPLATES } from "./guest";
import { HOST_TEMPLATES } from "./host";
import { SAMPLE_VALUES } from "./samples";
import type { EmailLocale, EmailTemplateDef } from "./types";

const samplesFor = (placeholders: readonly string[]) => {
  const pick = (locale: EmailLocale) =>
    Object.fromEntries(
      placeholders.map((name) => [name, SAMPLE_VALUES[locale][name]]),
    );
  return { en: pick("en"), el: pick("el") };
};

interface RegistryEntry extends EmailTemplateDef {
  /** False for text the host types each time. */
  editable: boolean;
  /** Without its booking this would be a hollow email, so it never sends. */
  needsBooking: boolean;
}

const guests: RegistryEntry[] = GUEST_TEMPLATES.map((template) => {
  const placeholders = template.standalone
    ? (template.extra ?? [])
    : [...BOOKING_PLACEHOLDERS, ...(template.extra ?? [])];
  return {
    key: template.key,
    audience: "guest",
    label: template.label,
    labelEl: template.labelEl,
    placeholders,
    required: template.required ?? [],
    copy: { en: template.en, el: template.el },
    sample: samplesFor(placeholders),
    needsGuestLink: template.needsGuestLink,
    editable: !template.fixed,
    needsBooking: !template.standalone,
  };
});

const hosts: RegistryEntry[] = HOST_TEMPLATES.map((template) => ({
  key: template.key,
  audience: "host",
  label: template.label,
  labelEl: template.labelEl,
  placeholders: template.placeholders,
  required: template.required ?? [],
  copy: { en: template.en, el: template.el },
  sample: samplesFor(template.placeholders),
  editable: true,
  needsBooking: !!template.needsBooking,
}));

export const TEMPLATES: readonly RegistryEntry[] = [...guests, ...hosts];

export const SCHEDULED_MESSAGE_KEY = "scheduled_message";

/** Other tracks write rows under these names. */
const ALIASES: Record<string, string> = {
  sync_conflict: "host_sync_conflict",
  sync_failure: "host_sync_failure",
};

/** The name of an email in the admin's language. */
export const templateLabel = (
  template: Pick<EmailTemplateDef, "label" | "labelEl">,
  lang: EmailLocale,
): string => (lang === "el" ? template.labelEl : template.label);

export function findTemplate(key: string): RegistryEntry | undefined {
  const name = ALIASES[key] ?? key;
  return TEMPLATES.find((template) => template.key === name);
}

export { BOOKING_PLACEHOLDERS };
