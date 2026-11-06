-- Row Level Security on every table (SUP-06). Table access starts at nothing
-- for public and signed-in roles; each grant below is deliberate. Writes that
-- touch inventory or money go through RPCs called from the server.

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

revoke all on all sequences in schema public from anon, authenticated;

-- Published content, readable by anyone. anon cannot execute the role helpers,
-- so its policies must never call them.
do $$
declare
  t text;
begin
  foreach t in array array['amenities', 'room_amenities', 'media', 'media_placements', 'property'] loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  foreach t in array array['faq', 'testimonials', 'places', 'pages'] loop
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format(
      'create policy public_read on public.%I for select to anon using (status = ''published'')', t);
    execute format(
      'create policy signed_in_read on public.%I for select to authenticated using (status = ''published'' or (select public.is_admin()))', t);
  end loop;
end;
$$;

grant select on public.rooms to anon, authenticated;
create policy public_read on public.rooms for select to anon using (is_active);
create policy signed_in_read on public.rooms for select to authenticated
  using (is_active or (select public.is_admin()));

grant select (key, value, is_public) on public.settings to anon;
grant select on public.settings to authenticated;
create policy public_read on public.settings for select to anon using (is_public);
create policy signed_in_read on public.settings for select to authenticated
  using (is_public or (select public.is_owner()));

-- Draft text stays hidden from anon through the column grant.
grant select (id, page_id, key, published, sort_order) on public.content_blocks to anon;
grant select on public.content_blocks to authenticated;
create policy public_read on public.content_blocks for select to anon
  using (published is not null and exists (
    select 1 from public.pages p where p.id = page_id and p.status = 'published'
  ));
create policy admin_read on public.content_blocks for select to authenticated
  using ((select public.is_admin()));

-- Owner manages configuration and content.
do $$
declare
  t text;
begin
  foreach t in array array[
    'property', 'rooms', 'amenities', 'room_amenities', 'media', 'media_placements',
    'settings', 'seasons', 'rate_overrides', 'taxes_fees', 'promo_codes',
    'cancellation_policies', 'pages', 'content_blocks', 'faq', 'testimonials', 'places',
    'email_templates', 'invoice_series', 'external_calendars'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy owner_write on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
  end loop;
end;
$$;

-- The counter can only move through next_invoice_number (INV-03).
revoke insert, update on public.invoice_series from authenticated;
grant insert (doc_type, prefix, is_active), update (prefix, is_active) on public.invoice_series to authenticated;

-- Owner and staff read operational data.
do $$
declare
  t text;
begin
  foreach t in array array[
    'bookings', 'guests', 'holds', 'inventory_claims', 'availability_blocks',
    'payments', 'refunds', 'external_events', 'sync_logs', 'email_logs',
    'contact_messages', 'seasons', 'rate_overrides', 'restrictions',
    'taxes_fees', 'promo_codes', 'cancellation_policies', 'external_calendars'
  ] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy admin_read on public.%I for select to authenticated using ((select public.is_admin()))', t);
  end loop;
end;
$$;

-- Staff can edit availability rules and work the inbox.
grant insert, update, delete on public.restrictions to authenticated;
create policy admin_write on public.restrictions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant update (status, is_read) on public.contact_messages to authenticated;
create policy admin_update on public.contact_messages for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Owner only.
do $$
declare
  t text;
begin
  foreach t in array array['audit_log', 'invoices', 'invoice_lines', 'job_runs', 'consent_log', 'stripe_events'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using ((select public.is_owner()))', t);
  end loop;
end;
$$;

-- A signed-in admin must see their own role before finishing MFA.
grant select on public.admin_profiles to authenticated;
create policy self_read on public.admin_profiles for select to authenticated
  using (id = auth.uid() or (select public.is_owner()));
grant insert, update, delete on public.admin_profiles to authenticated;
create policy owner_write on public.admin_profiles for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- Storage (SUP-16, SUP-21). Private buckets have no policies: files there are
-- reached only through short-lived signed URLs created on the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('media', 'media', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic']),
  ('invoices', 'invoices', false, 10485760, array['application/pdf']),
  ('uploads-private', 'uploads-private', false, 15728640, null);

-- Update and delete only reach rows the role can select.
create policy media_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'media' and (select public.is_owner()));
create policy media_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (select public.is_owner()));
create policy media_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (select public.is_owner()))
  with check (bucket_id = 'media' and (select public.is_owner()));
create policy media_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (select public.is_owner()));
