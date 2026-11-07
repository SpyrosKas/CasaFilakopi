-- Fixes from the ADMIN-OPS review.

-- Reports place a refund in the month it completed, not the month it started.
alter table public.refunds add column settled_at timestamptz;
update public.refunds set settled_at = created_at where status = 'succeeded';

create or replace function public.settle_refund(
  p_refund_id uuid,
  p_status public.refund_status,
  p_stripe_refund_id text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_booking_id uuid;
begin
  if p_status = 'pending' then
    raise exception 'invalid_transition';
  end if;
  select booking_id into v_booking_id from public.refunds where id = p_refund_id;
  if not found then
    raise exception 'refund_not_found';
  end if;
  perform 1 from public.bookings where id = v_booking_id for update;

  update public.refunds
  set status = p_status,
      stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
      settled_at = case when p_status = 'succeeded' then coalesce(settled_at, now()) end
  where id = p_refund_id;
  perform public.sync_refunded_status(v_booking_id);
end;
$$;

create function public.stamp_refund_settled() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'succeeded' and new.settled_at is null then
    new.settled_at = now();
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_refund_settled() from public, anon, authenticated;
create trigger refunds_settled before insert on public.refunds
  for each row execute function public.stamp_refund_settled();

-- The amount on an imported booking is Owner-only, so signed-in sessions lose
-- that column. The server reads it after checking the role.
revoke select on public.external_events from authenticated;
grant select (
  id, calendar_id, uid, start_date, end_date, summary, guest_name, guest_notes,
  guest_email, guest_phone, details_updated_at, created_at, updated_at
) on public.external_events to authenticated;

-- Staff can save contacts without touching an amount the Owner is editing.
drop function public.update_external_event_details(uuid, text, text, text, text, integer, uuid);
create function public.update_external_event_details(
  p_event_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_guest_notes text,
  p_amount_cents integer,
  p_actor uuid default null,
  p_update_amount boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  update public.external_events
  set guest_name = nullif(trim(p_guest_name), ''),
      guest_email = nullif(trim(p_guest_email), ''),
      guest_phone = nullif(trim(p_guest_phone), ''),
      guest_notes = nullif(trim(p_guest_notes), ''),
      amount_cents = case when p_update_amount then p_amount_cents else amount_cents end,
      details_updated_at = now()
  where id = p_event_id;
  if not found then
    raise exception 'event_not_found';
  end if;
end;
$$;
revoke all on function public.update_external_event_details(uuid, text, text, text, text, integer, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.update_external_event_details(uuid, text, text, text, text, integer, uuid, boolean)
  to service_role;

-- A disputed payment is still money received for the hand-entered cap.
create or replace function public.record_payment(
  p_booking_id uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_cents integer,
  p_payment_intent_id text default null,
  p_note text default null,
  p_recorded_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
  v_paid bigint;
  v_id uuid;
begin
  perform public.set_actor(p_recorded_by);
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;

  if p_payment_intent_id is not null then
    select id into v_id from public.payments where stripe_payment_intent_id = p_payment_intent_id;
    if found then
      return v_id;
    end if;
  else
    -- Stripe money has already moved, so only hand-entered amounts are capped.
    select
      (select coalesce(sum(amount_cents), 0) from public.payments
        where booking_id = p_booking_id and status in ('succeeded', 'disputed'))
      - (select coalesce(sum(amount_cents), 0) from public.refunds
        where booking_id = p_booking_id and status <> 'failed')
    into v_paid;
    if v_paid + p_amount_cents > v_booking.total_cents then
      raise exception 'overpayment';
    end if;
  end if;

  insert into public.payments (
    booking_id, kind, method, status, amount_cents,
    stripe_payment_intent_id, note, recorded_by, paid_at
  ) values (
    p_booking_id, p_kind, p_method, 'succeeded', p_amount_cents,
    p_payment_intent_id, p_note, p_recorded_by, now()
  ) returning id into v_id;
  return v_id;
end;
$$;
