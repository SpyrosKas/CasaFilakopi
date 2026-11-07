import { adminEn } from "@/lib/admin/strings";
import { channelsEn } from "@/lib/channels/strings";
import { cmsEn } from "@/lib/cms/strings";

// A schema or the CMS registry is built once, when its module loads, for every
// visitor, so it cannot hold words in one language. It holds a marker instead,
// which `say` from lib/admin/i18n.ts turns into words once the language of the
// request is known. `later` has the same shape and types as the catalogs, so
// the schemas read as before.

const MARK = "@@";

export interface Catalogs {
  admin: typeof adminEn;
  cms: typeof cmsEn;
  channels: typeof channelsEn;
}

function mirror<T>(value: T, name: string): T {
  if (typeof value === "string") return `${MARK}${name}` as T;
  if (typeof value === "function") {
    const marked = (...args: unknown[]) =>
      `${MARK}${name}(${JSON.stringify(args)})`;
    return marked as T;
  }
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      mirror(inner, `${name}.${key}`),
    ]),
  ) as T;
}

export const later: Catalogs = {
  admin: mirror(adminEn, "admin"),
  cms: mirror(cmsEn, "cms"),
  channels: mirror(channelsEn, "channels"),
};

export const isMarker = (text: string): boolean => text.startsWith(MARK);

const walk = (root: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      root,
    );

/** The words for a marker, from these catalogs. Other text comes back as is. */
export function resolveMarker(catalogs: Catalogs, text: string): string {
  if (!isMarker(text)) return text;
  const open = text.indexOf("(");
  const path = text.slice(MARK.length, open === -1 ? undefined : open);
  const found = walk(catalogs, path);
  if (typeof found === "string") return found;
  if (typeof found !== "function" || open === -1) return text;
  const args = JSON.parse(text.slice(open + 1, -1)) as unknown[];
  return found(
    ...args.map((arg) =>
      typeof arg === "string" ? resolveMarker(catalogs, arg) : arg,
    ),
  );
}
