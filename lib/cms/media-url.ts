// Where a stored photo is served from. Safe in the browser: the bucket is public.

export const MEDIA_BUCKET = "media";

/** Imported photos keep their folder and name under this prefix. */
export const SITE_PREFIX = "site/";

export function publicMediaUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  // Only a build with no settings at all, such as the CI check job, gets here.
  if (!base) return `/${MEDIA_BUCKET}/${encoded}`;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${MEDIA_BUCKET}/${encoded}`;
}
