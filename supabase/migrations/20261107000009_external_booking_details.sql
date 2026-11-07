-- iCal feeds carry dates, so Yorgos adds what the channels leave out (D19).
-- Amounts count as income only once entered here.

alter table public.external_events
  add column guest_email text,
  add column guest_phone text,
  add column amount_cents integer check (amount_cents >= 0),
  add column details_updated_at timestamptz;

create function public.update_external_event_details(
  p_event_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_guest_notes text,
  p_amount_cents integer,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  update public.external_events
  set guest_name = nullif(trim(p_guest_name), ''),
      guest_email = nullif(trim(p_guest_email), ''),
      guest_phone = nullif(trim(p_guest_phone), ''),
      guest_notes = nullif(trim(p_guest_notes), ''),
      amount_cents = p_amount_cents,
      details_updated_at = now()
  where id = p_event_id;
  if not found then
    raise exception 'event_not_found';
  end if;
end;
$$;

revoke all on function public.update_external_event_details(uuid, text, text, text, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.update_external_event_details(uuid, text, text, text, text, integer, uuid)
  to service_role;

create trigger audit_external_events after update on public.external_events
  for each row
  when (old.details_updated_at is distinct from new.details_updated_at)
  execute function public.audit_change('guest_name', 'guest_email', 'guest_phone', 'guest_notes');
