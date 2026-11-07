-- Notes on a booking, written through the server like every other booking
-- change, plus an audit trail for nightly prices.

create function public.update_booking_notes(
  p_booking_id uuid,
  p_notes text,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  update public.bookings
  set internal_notes = nullif(trim(p_notes), '')
  where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found';
  end if;
end;
$$;

revoke all on function public.update_booking_notes(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.update_booking_notes(uuid, text, uuid) to service_role;

-- rate_overrides has a composite key, so audit_change's entity id comes back
-- null. A dedicated trigger records which night changed.
create function public.audit_rate_override() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid),
    lower(tg_op), 'rate_overrides', (v_row ->> 'room_id') || ':' || (v_row ->> 'night'),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
revoke all on function public.audit_rate_override() from public, anon, authenticated;

create trigger audit_rate_overrides after insert or update or delete on public.rate_overrides
  for each row execute function public.audit_rate_override();
