-- The public needs a photo's path, size and alt text, never who uploaded it.
-- media.created_by is an admin's auth id, so anon now reads named columns only
-- (security review, 2026-11-08). Signed-in admins keep the whole row.

revoke select on public.media from anon;
grant select (id, bucket, path, mime_type, width, height, alt, created_at, updated_at)
  on public.media to anon;
