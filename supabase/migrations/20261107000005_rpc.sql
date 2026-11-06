-- Atomic operations (SUP-05). All are called by server code with the secret
-- key. Stripe and email calls happen outside these transactions.
-- Errors raised by message: dates_unavailable, invalid_dates, room_inactive,
-- booking_not_found, invalid_transition, refund_exceeds_payment, overpayment.
--
-- Lock order: booking row first, then the room lock. release_expired_holds
-- uses skip locked, so it never waits on a booking another call holds.

create function public.lock_room(p_room_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('room:' || p_room_id::text, 0));
end;
$$;

-- Names the admin behind an RPC for the audit log, for this transaction only.
create function public.set_actor(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
end;
$$;

create function public.release_promo(p_code text) returns void
language sql security definer set search_path = '' as $$
  update public.promo_codes set used_count = greatest(used_count - 1, 0)
  where lower(code) = lower(p_code);
$$;

create function public.next_booking_reference() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_year integer := extract(year from now() at time zone 'Europe/Athens');
  v_value integer;
begin
  insert into public.booking_reference_counters (year, last_value)
  values (v_year, 1)
  on conflict (year) do update
    set last_value = public.booking_reference_counters.last_value + 1
  returning last_value into v_value;
  return format('CF-%s-%s', v_year, lpad(v_value::text, 5, '0'));
end;
$$;

-- Gapless: the row lock is held until commit, and a rollback restores the number.
create function public.next_invoice_number(p_series_id uuid) returns integer
language sql security definer set search_path = '' as $$
  update public.invoice_series set last_number = last_number + 1
  where id = p_series_id returning last_number;
$$;

create function public.release_expired_holds(
  p_room_id uuid default null,
  p_stay daterange default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  with expired as (
    select h.booking_id
    from public.holds h
    join public.inventory_claims c on c.booking_id = h.booking_id and c.kind = 'hold'
    join public.bookings b on b.id = h.booking_id
    where h.expires_at <= now()
      and (p_room_id is null or c.room_id = p_room_id)
      and (p_stay is null or c.stay && p_stay)
    for update of b skip locked
  ), removed as (
    delete from public.inventory_claims c using expired e
    where c.booking_id = e.booking_id
    returning c.booking_id
  ), dropped as (
    delete from public.holds h using removed r where h.booking_id = r.booking_id
  ), updated as (
    update public.bookings b set status = 'expired'
    from removed r
    where b.id = r.booking_id and b.status = 'pending_payment'
    returning b.promo_code
  ), promos as (
    update public.promo_codes p set used_count = greatest(p.used_count - u.n, 0)
    from (
      select lower(promo_code) as code, count(*)::integer as n
      from updated where promo_code is not null group by 1
    ) u
    where lower(p.code) = u.code
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;

create function public.assert_room_sellable(p_room_id uuid, p_stay daterange) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Must stay volatile with the lock as its own statement: the check below
  -- then reads a fresh snapshot, so it sees an import that just committed.
  perform public.lock_room(p_room_id);

  if not exists (select 1 from public.rooms where id = p_room_id and is_active) then
    raise exception 'room_inactive';
  end if;
  -- Conflicted imports sit outside the constraint but still occupy the dates.
  if exists (
    select 1 from public.inventory_claims
    where room_id = p_room_id and stay && p_stay and is_conflicted
  ) then
    raise exception 'dates_unavailable';
  end if;
end;
$$;

create function public.find_or_create_guest(p_guest jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := nullif(trim(p_guest ->> 'email'), '');
  v_id uuid;
begin
  -- Existing guests are never modified here: the caller is unauthenticated.
  insert into public.guests (email, full_name, phone, country, locale)
  values (
    v_email, p_guest ->> 'name', p_guest ->> 'phone', p_guest ->> 'country',
    coalesce(p_guest ->> 'locale', 'en')
  )
  on conflict (lower(email)) where email is not null and anonymized_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.guests
    where lower(email) = lower(v_email) and anonymized_at is null;
  end if;
  return v_id;
end;
$$;

create function public.create_hold(
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_guest jsonb,
  p_price_breakdown jsonb,
  p_total_cents integer,
  p_due_now_cents integer,
  p_rules_snapshot jsonb,
  p_terms_version text,
  p_token_hash text,
  p_token_expires_at timestamptz,
  p_hold_minutes integer default 35,
  p_promo_code text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_stay daterange;
  v_booking_id uuid;
  v_expires_at timestamptz := now() + make_interval(mins => p_hold_minutes);
begin
  -- A Stripe Checkout Session lives at least 30 minutes, so a shorter hold
  -- could end while the guest can still pay.
  if p_hold_minutes < 31 then
    raise exception 'hold_too_short';
  end if;
  if p_check_out <= p_check_in or p_check_in < (now() at time zone 'Europe/Athens')::date then
    raise exception 'invalid_dates';
  end if;

  v_stay := daterange(p_check_in, p_check_out);
  perform public.release_expired_holds(p_room_id, v_stay);
  perform public.assert_room_sellable(p_room_id, v_stay);

  -- Counted here so two guests cannot both take a code's last use (BKG-04).
  -- Released again if the hold expires or is cancelled before payment.
  if p_promo_code is not null then
    update public.promo_codes
    set used_count = used_count + 1
    where lower(code) = lower(p_promo_code)
      and is_active
      and (max_uses is null or used_count < max_uses)
      and (valid_from is null or valid_from <= (now() at time zone 'Europe/Athens')::date)
      and (valid_to is null or valid_to >= (now() at time zone 'Europe/Athens')::date)
      and (room_ids is null or p_room_id = any (room_ids));
    if not found then
      raise exception 'promo_unavailable';
    end if;
  end if;

  insert into public.bookings (
    room_id, guest_id, status, source, check_in, check_out, adults, children,
    guest_name, guest_email, guest_phone, guest_country, locale, arrival_time,
    special_requests, price_breakdown, total_cents, due_now_cents, rules_snapshot,
    terms_version, terms_accepted_at, access_token_hash, access_token_expires_at,
    promo_code, marketing_consent
  ) values (
    p_room_id, public.find_or_create_guest(p_guest), 'pending_payment', 'direct',
    p_check_in, p_check_out, p_adults, p_children,
    p_guest ->> 'name', p_guest ->> 'email', p_guest ->> 'phone', p_guest ->> 'country',
    coalesce(p_guest ->> 'locale', 'en'), p_guest ->> 'arrival_time',
    p_guest ->> 'special_requests', p_price_breakdown, p_total_cents, p_due_now_cents,
    p_rules_snapshot, p_terms_version, now(), p_token_hash, p_token_expires_at,
    p_promo_code, coalesce((p_guest ->> 'marketing_consent')::boolean, false)
  ) returning id into v_booking_id;

  if (p_guest ->> 'marketing_consent')::boolean then
    insert into public.consent_log (kind, subject, policy_version, granted)
    values ('marketing', v_booking_id::text, p_terms_version, true);
  end if;

  insert into public.holds (booking_id, expires_at) values (v_booking_id, v_expires_at);

  begin
    insert into public.inventory_claims (room_id, stay, kind, booking_id)
    values (p_room_id, v_stay, 'hold', v_booking_id);
  exception when exclusion_violation then
    raise exception 'dates_unavailable';
  end;

  return jsonb_build_object('booking_id', v_booking_id, 'expires_at', v_expires_at);
end;
$$;

create function public.attach_checkout_session(p_booking_id uuid, p_session_id text) returns void
language sql security definer set search_path = '' as $$
  update public.holds set stripe_checkout_session_id = p_session_id
  where booking_id = p_booking_id;
$$;

-- Takes the dates for a paying booking. False means they cannot be had: the
-- hold ended and someone else took them, or an import already sold them.
create function public.secure_claim(p_booking public.bookings) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_stay daterange := daterange(p_booking.check_in, p_booking.check_out);
begin
  perform public.lock_room(p_booking.room_id);

  if exists (
    select 1 from public.inventory_claims
    where room_id = p_booking.room_id and stay && v_stay and is_conflicted
  ) then
    delete from public.inventory_claims where booking_id = p_booking.id;
    return false;
  end if;

  if exists (select 1 from public.inventory_claims where booking_id = p_booking.id) then
    update public.inventory_claims set kind = 'booking' where booking_id = p_booking.id;
    return true;
  end if;

  perform public.release_expired_holds(p_booking.room_id, v_stay);
  begin
    insert into public.inventory_claims (room_id, stay, kind, booking_id)
    values (p_booking.room_id, v_stay, 'booking', p_booking.id);
  exception when exclusion_violation then
    return false;
  end;
  return true;
end;
$$;

create function public.finish_confirmation(p_booking public.bookings) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_reference text := public.next_booking_reference();
begin
  delete from public.holds where booking_id = p_booking.id;
  update public.bookings
  set status = 'confirmed', reference = v_reference, confirmed_at = now()
  where id = p_booking.id;
  if p_booking.marketing_consent then
    update public.guests set marketing_consent = true where id = p_booking.guest_id;
  end if;
  return v_reference;
end;
$$;

create function public.fail_confirmation(p_booking public.bookings) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.holds where booking_id = p_booking.id;
  update public.bookings set status = 'expired'
  where id = p_booking.id and status = 'pending_payment';
  if p_booking.status = 'pending_payment' and p_booking.promo_code is not null then
    perform public.release_promo(p_booking.promo_code);
  end if;
end;
$$;

-- Called from the verified Stripe webhook only (BKG-12). Safe to repeat.
-- Outcomes:
--   confirmed, already_confirmed: normal.
--   extra_payment: a second, different payment on a confirmed booking.
--   amount_mismatch: money taken is not the amount due. Booking stays
--     unconfirmed; the payment is recorded and the host must be alerted.
--   dates_lost: money taken but the dates are gone. The payment is recorded;
--     the caller must refund and alert the host.
create function public.confirm_booking(
  p_booking_id uuid,
  p_kind public.payment_kind,
  p_amount_cents integer,
  p_payment_intent_id text,
  p_checkout_session_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
  v_existing public.payments;
begin
  if p_payment_intent_id is null then
    raise exception 'payment_intent_required';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- A payment already seen is a replay. It must never touch inventory: the
  -- booking may since have been cancelled, refunded or moved.
  select * into v_existing from public.payments
  where stripe_payment_intent_id = p_payment_intent_id;
  if found then
    if v_existing.booking_id <> p_booking_id then
      raise exception 'payment_booking_mismatch';
    end if;
    if v_booking.confirmed_at is not null then
      return jsonb_build_object('outcome', 'already_confirmed', 'reference', v_booking.reference);
    elsif v_existing.amount_cents <> v_booking.due_now_cents then
      return jsonb_build_object('outcome', 'amount_mismatch');
    end if;
    return jsonb_build_object('outcome', 'dates_lost');
  end if;

  insert into public.payments (
    booking_id, kind, method, status, amount_cents,
    stripe_payment_intent_id, stripe_checkout_session_id, paid_at
  ) values (
    p_booking_id, p_kind, 'card', 'succeeded', p_amount_cents,
    p_payment_intent_id, p_checkout_session_id, now()
  );

  if v_booking.status in ('confirmed', 'checked_in', 'completed') then
    return jsonb_build_object('outcome', 'extra_payment', 'reference', v_booking.reference);
  end if;

  if p_amount_cents <> v_booking.due_now_cents then
    return jsonb_build_object('outcome', 'amount_mismatch');
  end if;

  if v_booking.status in ('pending_payment', 'expired') and public.secure_claim(v_booking) then
    return jsonb_build_object(
      'outcome', 'confirmed', 'reference', public.finish_confirmation(v_booking)
    );
  end if;

  perform public.fail_confirmation(v_booking);
  return jsonb_build_object('outcome', 'dates_lost');
end;
$$;

-- For bookings with nothing due now: pay on arrival, or a 100% promo.
create function public.confirm_without_payment(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.confirmed_at is not null then
    return jsonb_build_object('outcome', 'already_confirmed', 'reference', v_booking.reference);
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'invalid_transition';
  end if;
  if v_booking.due_now_cents <> 0 then
    raise exception 'payment_required';
  end if;

  if public.secure_claim(v_booking) then
    return jsonb_build_object(
      'outcome', 'confirmed', 'reference', public.finish_confirmation(v_booking)
    );
  end if;
  perform public.fail_confirmation(v_booking);
  return jsonb_build_object('outcome', 'dates_lost');
end;
$$;

create function public.create_manual_booking(
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_guest jsonb,
  p_price_breakdown jsonb,
  p_total_cents integer,
  p_rules_snapshot jsonb,
  p_source public.booking_source default 'manual',
  p_internal_notes text default null,
  p_token_hash text default null,
  p_token_expires_at timestamptz default null,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_stay daterange;
  v_id uuid;
  v_reference text;
begin
  perform public.set_actor(p_actor);
  if p_check_out <= p_check_in then
    raise exception 'invalid_dates';
  end if;
  v_stay := daterange(p_check_in, p_check_out);
  perform public.release_expired_holds(p_room_id, v_stay);
  perform public.assert_room_sellable(p_room_id, v_stay);

  v_reference := public.next_booking_reference();
  insert into public.bookings (
    reference, room_id, guest_id, status, source, check_in, check_out, adults, children,
    guest_name, guest_email, guest_phone, guest_country, locale, price_breakdown,
    total_cents, due_now_cents, rules_snapshot, internal_notes, confirmed_at,
    access_token_hash, access_token_expires_at
  ) values (
    v_reference, p_room_id, public.find_or_create_guest(p_guest), 'confirmed', p_source,
    p_check_in, p_check_out, p_adults, p_children,
    p_guest ->> 'name', p_guest ->> 'email', p_guest ->> 'phone', p_guest ->> 'country',
    coalesce(p_guest ->> 'locale', 'en'), p_price_breakdown, p_total_cents, 0,
    p_rules_snapshot, p_internal_notes, now(), p_token_hash, p_token_expires_at
  ) returning id into v_id;

  begin
    insert into public.inventory_claims (room_id, stay, kind, booking_id)
    values (p_room_id, v_stay, 'booking', v_id);
  exception when exclusion_violation then
    raise exception 'dates_unavailable';
  end;

  return jsonb_build_object('booking_id', v_id, 'reference', v_reference);
end;
$$;

create function public.record_payment(
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
        where booking_id = p_booking_id and status = 'succeeded')
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

create function public.sync_refunded_status(p_booking_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_net bigint;
begin
  select
    (select coalesce(sum(amount_cents), 0) from public.payments
      where booking_id = p_booking_id and status in ('succeeded', 'disputed'))
    - (select coalesce(sum(amount_cents), 0) from public.refunds
      where booking_id = p_booking_id and status = 'succeeded')
  into v_net;

  update public.bookings
  set status = case when v_net = 0 then 'refunded' else 'cancelled' end::public.booking_status
  where id = p_booking_id
    and status in ('cancelled', 'refunded')
    and exists (
      select 1 from public.refunds
      where booking_id = p_booking_id and status <> 'pending'
    );
end;
$$;

create function public.cancel_booking(
  p_booking_id uuid,
  p_reason text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings;
begin
  perform public.set_actor(p_actor);
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_booking.status in ('cancelled', 'refunded') then
    return jsonb_build_object('outcome', 'already_cancelled');
  end if;
  if v_booking.status not in ('pending_payment', 'confirmed', 'checked_in') then
    raise exception 'invalid_transition';
  end if;

  delete from public.inventory_claims where booking_id = p_booking_id;
  delete from public.holds where booking_id = p_booking_id;
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
  where id = p_booking_id;

  if v_booking.status = 'pending_payment' and v_booking.promo_code is not null then
    perform public.release_promo(v_booking.promo_code);
  end if;
  perform public.sync_refunded_status(p_booking_id);

  return jsonb_build_object('outcome', 'cancelled');
end;
$$;

-- Admin refund flow: reserve_refund before calling Stripe, so the cap is
-- enforced while it can still stop the money, then settle_refund with Stripe's
-- answer. A failed refund releases the reservation.
create function public.reserve_refund(
  p_booking_id uuid,
  p_payment_id uuid,
  p_amount_cents integer,
  p_reason text default null,
  p_actor uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments;
  v_refunded bigint;
  v_id uuid;
begin
  perform public.set_actor(p_actor);
  perform 1 from public.bookings where id = p_booking_id for update;

  select * into v_payment from public.payments
  where id = p_payment_id and booking_id = p_booking_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;
  if v_payment.status <> 'succeeded' then
    raise exception 'payment_not_refundable';
  end if;

  select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds
  where payment_id = p_payment_id and status <> 'failed';
  if v_refunded + p_amount_cents > v_payment.amount_cents then
    raise exception 'refund_exceeds_payment';
  end if;

  insert into public.refunds (booking_id, payment_id, amount_cents, status, reason, recorded_by)
  values (p_booking_id, p_payment_id, p_amount_cents, 'pending', p_reason, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;

-- Safe to repeat. Also handles Stripe reporting a refund as failed later.
create function public.settle_refund(
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
  set status = p_status, stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id)
  where id = p_refund_id;
  perform public.sync_refunded_status(v_booking_id);
end;
$$;

-- For money that has already moved: a refund made in the Stripe dashboard, or
-- cash handed back. Stripe refunds are recorded even past the cap, since the
-- money is gone and the record must match reality; hand-entered ones are capped.
create function public.record_refund(
  p_booking_id uuid,
  p_payment_id uuid,
  p_amount_cents integer,
  p_stripe_refund_id text default null,
  p_reason text default null,
  p_recorded_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments;
  v_refunded bigint;
  v_id uuid;
begin
  perform public.set_actor(p_recorded_by);
  perform 1 from public.bookings where id = p_booking_id for update;

  if p_stripe_refund_id is not null then
    select id into v_id from public.refunds where stripe_refund_id = p_stripe_refund_id;
    if found then
      return v_id;
    end if;
  end if;

  select * into v_payment from public.payments
  where id = p_payment_id and booking_id = p_booking_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  if p_stripe_refund_id is null then
    if v_payment.status <> 'succeeded' then
      raise exception 'payment_not_refundable';
    end if;
    select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds
    where payment_id = p_payment_id and status <> 'failed';
    if v_refunded + p_amount_cents > v_payment.amount_cents then
      raise exception 'refund_exceeds_payment';
    end if;
  end if;

  insert into public.refunds (
    booking_id, payment_id, amount_cents, status, reason, stripe_refund_id, recorded_by
  ) values (
    p_booking_id, p_payment_id, p_amount_cents, 'succeeded', p_reason, p_stripe_refund_id, p_recorded_by
  ) returning id into v_id;

  perform public.sync_refunded_status(p_booking_id);
  return v_id;
end;
$$;

create function public.modify_booking(
  p_booking_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_price_breakdown jsonb,
  p_total_cents integer,
  p_token_expires_at timestamptz default null,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.booking_status;
  v_stay daterange;
begin
  perform public.set_actor(p_actor);
  select status into v_status from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_status not in ('confirmed', 'checked_in') then
    raise exception 'invalid_transition';
  end if;
  if p_check_out <= p_check_in then
    raise exception 'invalid_dates';
  end if;

  v_stay := daterange(p_check_in, p_check_out);
  perform public.release_expired_holds(p_room_id, v_stay);
  perform public.assert_room_sellable(p_room_id, v_stay);

  begin
    update public.inventory_claims set room_id = p_room_id, stay = v_stay
    where booking_id = p_booking_id;
  exception when exclusion_violation then
    raise exception 'dates_unavailable';
  end;

  update public.bookings
  set room_id = p_room_id, check_in = p_check_in, check_out = p_check_out,
      price_breakdown = p_price_breakdown, total_cents = p_total_cents,
      due_now_cents = least(due_now_cents, p_total_cents),
      access_token_expires_at = coalesce(p_token_expires_at, access_token_expires_at)
  where id = p_booking_id;
end;
$$;

create function public.transition_booking(
  p_booking_id uuid,
  p_status public.booking_status,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.booking_status;
begin
  perform public.set_actor(p_actor);
  select status into v_status from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if not (
    (v_status = 'confirmed' and p_status in ('checked_in', 'no_show'))
    or (v_status = 'checked_in' and p_status = 'completed')
  ) then
    raise exception 'invalid_transition';
  end if;
  if p_status = 'no_show' then
    delete from public.inventory_claims where booking_id = p_booking_id;
  end if;
  update public.bookings set status = p_status where id = p_booking_id;
end;
$$;

create function public.complete_finished_bookings() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.bookings set status = 'completed'
  where status in ('confirmed', 'checked_in')
    and check_out < (now() at time zone 'Europe/Athens')::date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.create_block(
  p_room_id uuid,
  p_start date,
  p_end date,
  p_reason public.block_reason,
  p_note text default null,
  p_created_by uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.set_actor(p_created_by);
  if p_end <= p_start then
    raise exception 'invalid_dates';
  end if;
  perform public.release_expired_holds(p_room_id, daterange(p_start, p_end));

  insert into public.availability_blocks (room_id, start_date, end_date, reason, note, created_by)
  values (p_room_id, p_start, p_end, p_reason, p_note, p_created_by)
  returning id into v_id;

  begin
    insert into public.inventory_claims (room_id, stay, kind, block_id)
    values (p_room_id, daterange(p_start, p_end), 'block', v_id);
  exception when exclusion_violation then
    raise exception 'dates_unavailable';
  end;
  return v_id;
end;
$$;

create function public.remove_block(p_block_id uuid, p_actor uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  delete from public.availability_blocks where id = p_block_id;
end;
$$;

-- Imported events are never rejected. A collision is stored and flagged (CHN-13).
create function public.upsert_external_event(
  p_calendar_id uuid,
  p_uid text,
  p_start date,
  p_end date,
  p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_room_id uuid;
  v_event_id uuid;
  v_stay daterange;
  v_conflicted boolean := false;
  v_was_conflicted boolean;
begin
  if p_end <= p_start then
    raise exception 'invalid_dates';
  end if;
  v_stay := daterange(p_start, p_end);

  select room_id into v_room_id from public.external_calendars where id = p_calendar_id;
  if not found then
    raise exception 'calendar_not_found';
  end if;

  -- Serialised with create_hold: a conflicted row is outside the constraint,
  -- so only this lock stops a hold slipping past one that is still uncommitted.
  perform public.lock_room(v_room_id);
  perform public.release_expired_holds(v_room_id, v_stay);

  insert into public.external_events (calendar_id, uid, start_date, end_date, summary)
  values (p_calendar_id, p_uid, p_start, p_end, p_summary)
  on conflict (calendar_id, uid) do update
    set start_date = excluded.start_date, end_date = excluded.end_date, summary = excluded.summary
  returning id into v_event_id;

  select is_conflicted into v_was_conflicted from public.inventory_claims
  where external_event_id = v_event_id;

  begin
    insert into public.inventory_claims (room_id, stay, kind, external_event_id)
    values (v_room_id, v_stay, 'external', v_event_id)
    on conflict (external_event_id) do update set stay = excluded.stay, is_conflicted = false;
  exception when exclusion_violation then
    v_conflicted := true;
    insert into public.inventory_claims (room_id, stay, kind, external_event_id, is_conflicted)
    values (v_room_id, v_stay, 'external', v_event_id, true)
    on conflict (external_event_id) do update set stay = excluded.stay, is_conflicted = true;
  end;

  return jsonb_build_object(
    'event_id', v_event_id,
    'is_conflicted', v_conflicted,
    -- Alert only on this, so the host is not emailed on every sync.
    'is_new_conflict', v_conflicted and not coalesce(v_was_conflicted, false)
  );
end;
$$;

-- Events gone from the feed are released (CHN-07).
create function public.remove_missing_external_events(
  p_calendar_id uuid,
  p_seen_uids text[],
  p_allow_empty boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  -- An empty response from a provider must not reopen every sold date. The
  -- sync sets p_allow_empty only after consecutive empty runs.
  if coalesce(cardinality(p_seen_uids), 0) = 0 and not p_allow_empty then
    raise exception 'empty_feed_refused';
  end if;

  delete from public.external_events
  where calendar_id = p_calendar_id and not (uid = any (coalesce(p_seen_uids, '{}')));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.booking_for_token(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'reference', b.reference, 'status', b.status,
    'check_in', b.check_in, 'check_out', b.check_out,
    'adults', b.adults, 'children', b.children,
    'guest_name', b.guest_name, 'guest_email', b.guest_email,
    'price_breakdown', b.price_breakdown, 'total_cents', b.total_cents,
    'due_now_cents', b.due_now_cents, 'rules_snapshot', b.rules_snapshot,
    'locale', b.locale
  )
  from public.bookings b
  where b.access_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and b.access_token_expires_at > now();
$$;

-- AVL-09: the one public window on availability. Exposes yes or no per night.
create function public.public_availability(
  p_room_id uuid,
  p_from date,
  p_to date
) returns table (night date, is_available boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_to <= p_from or p_to - p_from > 731 then
    raise exception 'invalid_dates';
  end if;

  return query
  select d::date, r.is_active and not exists (
    select 1
    from public.inventory_claims c
    left join public.holds h on h.booking_id = c.booking_id and c.kind = 'hold'
    where c.room_id = p_room_id
      and c.stay @> d::date
      and (h.id is null or h.expires_at > now())
  )
  from generate_series(p_from, p_to - 1, interval '1 day') d
  cross join public.rooms r
  where r.id = p_room_id;
end;
$$;

-- Functions are private unless granted here. PUBLIC can execute new functions
-- in every schema by default, which a per-schema default cannot undo, so the
-- global default is revoked too.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

grant execute on function public.current_admin_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.public_availability(uuid, date, date) to anon, authenticated;
