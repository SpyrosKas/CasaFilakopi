-- Fixes from the independent review of erasure, retention, users and jobs.
--
-- Erasure used to search for a person's name and any phone as a substring of
-- whole tables, so a guest called "Mark" matched `marketing_consent` in every
-- audit row. It is now scoped by key: ids, an exact email, or a phone's digits
-- when there are at least 8 of them. A name alone never erases anything.

drop function public.scrub_personal_data(uuid[], uuid[], text[], text[], text[]);
drop function public.matching_external_events(text[], text[], text[]);
drop function public.identity_needles(text[], text[], text[]);

-- A phone's digits, only when they are enough to identify someone.
create function public.phone_keys(p_phones text[]) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct d), '{}') from (
    select public.only_digits(p) as d from unnest(p_phones) p
  ) s
  where length(d) >= 8;
$$;

-- Same person, by email or phone. Names are shown to the Owner as candidates
-- by the app and are never used here.
create function public.matching_external_events(p_emails text[], p_phones text[])
returns setof public.external_events
language sql stable set search_path = '' as $$
  select e.* from public.external_events e
  where lower(trim(e.guest_email)) = any (p_emails)
    or public.only_digits(e.guest_phone) = any (public.phone_keys(p_phones));
$$;

-- Money that is not settled, or not yet documented for the tax records.
-- Evidence and contact details are still needed for these.
create function public.has_open_money(p_booking_ids uuid[]) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.refunds r
    where r.booking_id = any (p_booking_ids) and r.status = 'pending'
  ) or exists (
    select 1 from public.payments p
    where p.booking_id = any (p_booking_ids)
      and (
        p.status in ('pending', 'disputed')
        or (p.status = 'succeeded' and not exists (
          select 1 from public.invoices i
          where i.status = 'issued' and i.doc_type <> 'credit_note'
            and (
              i.payment_id = p.id
              or (i.payment_id is null and i.booking_id = p.booking_id)
            )
        ))
      )
  );
$$;

create function public.scrub_personal_data(
  p_booking_ids uuid[],
  p_event_ids uuid[],
  p_emails text[],
  p_phones text[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_phone_keys text[] := public.phone_keys(p_phones);
  v_refs text[];
  v_contact_ids uuid[];
  v_emails integer;
  v_stripe integer;
  v_audit integer;
  v_audit_events integer;
begin
  update public.bookings
  set guest_name = null, guest_email = null, guest_phone = null, guest_country = null,
      arrival_time = null, special_requests = null, internal_notes = null,
      cancellation_reason = null, marketing_consent = false,
      -- The guest's private link stops working.
      access_token_hash = null, access_token_expires_at = null
  where id = any (p_booking_ids);

  update public.payments set note = null where booking_id = any (p_booking_ids);
  update public.refunds set reason = null where booking_id = any (p_booking_ids);

  update public.external_events
  set summary = null, guest_name = null, guest_email = null, guest_phone = null,
      guest_notes = null, anonymized_at = now()
  where id = any (p_event_ids);

  with hit as (
    update public.contact_messages
    set name = 'Anonymised', email = 'anonymised', phone = null,
        dates_of_interest = null, message = '', is_read = true
    where booking_id = any (p_booking_ids)
      or lower(trim(email)) = any (p_emails)
      or public.only_digits(phone) = any (v_phone_keys)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_contact_ids from hit;

  -- Anything of theirs still waiting would go to an address that is gone. A row
  -- on some other booking keeps its status, and if it is on its way it is left
  -- alone: that email is not about this person's erased stays.
  update public.email_logs
  set recipient = 'anonymised', payload = '{}', last_error = null,
      status = case
        when status in ('queued', 'sending')
          and (booking_id is null or booking_id = any (p_booking_ids)) then 'failed'
        else status
      end
  where booking_id = any (p_booking_ids)
    or (
      (
        contact_message_id = any (v_contact_ids)
        or lower(trim(recipient)) = any (p_emails)
        or lower(trim(payload ->> 'recipient')) = any (p_emails)
      )
      and (booking_id is null or status not in ('queued', 'sending'))
    );
  get diagnostics v_emails = row_count;

  -- Whole JSON string values only, in quotes: an id or an exact address, never
  -- a piece of text. Lower-cased, because mentions() compares lower-case.
  select coalesce(array_agg(to_jsonb(lower(r))::text), '{}') into v_refs from (
    select b::text as r from unnest(p_booking_ids) b
    union select stripe_payment_intent_id from public.payments
      where booking_id = any (p_booking_ids) and stripe_payment_intent_id is not null
    union select stripe_checkout_session_id from public.payments
      where booking_id = any (p_booking_ids) and stripe_checkout_session_id is not null
    union select stripe_checkout_session_id from public.holds
      where booking_id = any (p_booking_ids) and stripe_checkout_session_id is not null
    union select e from unnest(p_emails) e
  ) s;

  update public.stripe_events
  set payload = '{"anonymised": true}', error = null
  where public.mentions(payload::text, v_refs);
  get diagnostics v_stripe = row_count;

  -- The triggers already leave out contact fields. These free-text ones were
  -- never left out. Only this person's own bookings and imported stays, by id,
  -- and only these keys: history of everything else stays exactly as it was.
  update public.audit_log
  set before = before - array['arrival_time', 'cancellation_reason'],
      after = after - array['arrival_time', 'cancellation_reason']
  where entity = 'bookings'
    and entity_id = any (select b::text from unnest(p_booking_ids) b)
    and (
      before ?| array['arrival_time', 'cancellation_reason']
      or after ?| array['arrival_time', 'cancellation_reason']
    );
  get diagnostics v_audit = row_count;

  update public.audit_log
  set before = before - 'summary', after = after - 'summary'
  where entity = 'external_events'
    and entity_id = any (select e::text from unnest(p_event_ids) e)
    and (before ? 'summary' or after ? 'summary');
  get diagnostics v_audit_events = row_count;

  return jsonb_build_object(
    'bookings', coalesce(cardinality(p_booking_ids), 0),
    'external_events', coalesce(cardinality(p_event_ids), 0),
    'contact_messages', cardinality(v_contact_ids),
    'email_logs', v_emails,
    'stripe_events', v_stripe,
    'audit_entries', v_audit + v_audit_events
  );
end;
$$;

create or replace function public.anonymise_guest(p_guest_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest public.guests;
  v_booking_ids uuid[];
  v_event_ids uuid[];
  v_emails text[];
  v_phones text[];
  v_counts jsonb;
begin
  perform public.set_actor(p_actor);

  -- Conflicts with the key-share lock a new booking takes on this row, so a
  -- booking being made right now is seen by the check below.
  select * into v_guest from public.guests where id = p_guest_id for update;
  if not found then
    raise exception 'guest_not_found';
  end if;
  if v_guest.anonymized_at is not null then
    return jsonb_build_object('already', true);
  end if;

  select coalesce(array_agg(id), '{}') into v_booking_ids from public.bookings
  where guest_id = p_guest_id
    or lower(trim(guest_email)) = lower(trim(v_guest.email));

  select
    coalesce(array_agg(distinct x.email) filter (where x.email is not null), '{}'),
    coalesce(array_agg(distinct x.phone) filter (where x.phone is not null), '{}')
  into v_emails, v_phones
  from (
    select nullif(lower(trim(v_guest.email)), '') as email,
           nullif(trim(v_guest.phone), '') as phone
    union all
    select nullif(lower(trim(b.guest_email)), ''), nullif(trim(b.guest_phone), '')
    from public.bookings b where b.id = any (v_booking_ids)
  ) x;

  if exists (
    select 1 from public.bookings
    where id = any (v_booking_ids)
      and status in ('pending_payment', 'confirmed', 'checked_in')
      and check_out >= public.house_today()
  ) or exists (
    select 1 from public.matching_external_events(v_emails, v_phones)
    where end_date >= public.house_today()
  ) then
    raise exception 'guest_has_stay';
  end if;

  if public.has_open_money(v_booking_ids) then
    raise exception 'guest_has_open_money';
  end if;

  select coalesce(array_agg(id), '{}') into v_event_ids
  from public.matching_external_events(v_emails, v_phones);

  update public.guests
  set email = null, full_name = null, phone = null, country = null,
      marketing_consent = false, anonymized_at = now()
  where id = p_guest_id;

  v_counts := public.scrub_personal_data(v_booking_ids, v_event_ids, v_emails, v_phones);

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'anonymise', 'guests', p_guest_id::text, v_counts);
  return v_counts;
end;
$$;

create or replace function public.anonymise_external_guest(p_event_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.external_events;
  v_event_ids uuid[];
  v_booking_ids uuid[];
  v_emails text[];
  v_phones text[];
  v_counts jsonb;
begin
  perform public.set_actor(p_actor);
  select * into v_event from public.external_events where id = p_event_id;
  if not found then
    raise exception 'guest_not_found';
  end if;

  v_emails := array_remove(array[nullif(lower(trim(v_event.guest_email)), '')], null);
  v_phones := array_remove(array[nullif(trim(v_event.guest_phone), '')], null);

  -- The same person may also have booked directly. Those bookings are not
  -- erased from here, but they must not lose anything they still need.
  select coalesce(array_agg(id), '{}') into v_booking_ids from public.bookings
  where lower(trim(guest_email)) = any (v_emails)
    or public.only_digits(guest_phone) = any (public.phone_keys(v_phones));

  if v_event.end_date >= public.house_today()
    or exists (
      select 1 from public.matching_external_events(v_emails, v_phones)
      where end_date >= public.house_today()
    )
    or exists (
      select 1 from public.bookings
      where id = any (v_booking_ids)
        and status in ('pending_payment', 'confirmed', 'checked_in')
        and check_out >= public.house_today()
    )
  then
    raise exception 'guest_has_stay';
  end if;

  if public.has_open_money(v_booking_ids) then
    raise exception 'guest_has_open_money';
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_event_ids from (
    select id from public.matching_external_events(v_emails, v_phones)
    union select p_event_id
  ) s;

  v_counts := public.scrub_personal_data('{}', v_event_ids, v_emails, v_phones);

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'anonymise', 'external_events', p_event_id::text, v_counts);
  return v_counts;
end;
$$;

create or replace function public.apply_retention(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_years integer;
  v_cutoff date;
  v_guest uuid;
  v_guests integer := 0;
  v_skipped integer := 0;
  v_kept_bookings uuid[] := '{}';
  v_events integer;
  v_contacts integer;
  v_emails integer;
  v_stripe integer;
  v_audit integer := 0;
begin
  select (value ->> 'years')::integer into v_years
  from public.settings where key = 'retention';
  -- A missing or broken value must stop the job, never erase everything.
  if v_years is null or v_years not between 1 and 30 then
    raise exception 'retention_setting_invalid';
  end if;
  v_cutoff := public.house_today() - make_interval(years => v_years);

  for v_guest in
    select g.id from public.guests g
    where g.anonymized_at is null
      and coalesce(
        (select max(b.check_out) from public.bookings b where b.guest_id = g.id),
        g.created_at::date
      ) < v_cutoff
  loop
    if p_dry_run then
      v_guests := v_guests + 1;
      continue;
    end if;
    begin
      perform public.anonymise_guest(v_guest, null);
      v_guests := v_guests + 1;
    exception when others then
      -- A stay still to come, or money not settled or documented: their turn
      -- comes later, and what is kept for them must survive this run too.
      -- Anything else is a real fault and fails the job.
      if sqlerrm not in ('guest_has_stay', 'guest_has_open_money') then
        raise;
      end if;
      v_skipped := v_skipped + 1;
      v_kept_bookings := v_kept_bookings || coalesce(
        (select array_agg(b.id) from public.bookings b where b.guest_id = v_guest), '{}'
      );
    end;
  end loop;

  if p_dry_run then
    select count(*) into v_events from public.external_events
    where end_date < v_cutoff and anonymized_at is null;
    select count(*) into v_contacts from public.contact_messages
    where created_at < v_cutoff;
    select count(*) into v_emails from public.email_logs
    where created_at < v_cutoff and status not in ('queued', 'sending');
    select count(*) into v_stripe from public.stripe_events
    where received_at < v_cutoff and payload <> '{"anonymised": true}';
  else
    update public.external_events
    set summary = null, guest_name = null, guest_email = null, guest_phone = null,
        guest_notes = null, anonymized_at = now()
    where end_date < v_cutoff and anonymized_at is null;
    get diagnostics v_events = row_count;

    -- Old history of imported stays can quote the calendar text.
    update public.audit_log
    set before = before - 'summary', after = after - 'summary'
    where entity = 'external_events' and created_at < v_cutoff
      and (before ? 'summary' or after ? 'summary');
    get diagnostics v_audit = row_count;

    delete from public.email_logs
    where created_at < v_cutoff and status not in ('queued', 'sending')
      and (booking_id is null or not booking_id = any (v_kept_bookings));
    get diagnostics v_emails = row_count;

    delete from public.contact_messages
    where created_at < v_cutoff
      and (booking_id is null or not booking_id = any (v_kept_bookings));
    get diagnostics v_contacts = row_count;

    update public.stripe_events
    set payload = '{"anonymised": true}', error = null
    where received_at < v_cutoff and payload <> '{"anonymised": true}';
    get diagnostics v_stripe = row_count;

    if v_guests + v_skipped + v_events + v_emails + v_contacts + v_stripe + v_audit > 0 then
      insert into public.audit_log (action, entity, after)
      values ('retention', 'guests', jsonb_build_object(
        'guests', v_guests, 'guests_skipped', v_skipped, 'external_events', v_events,
        'email_logs', v_emails, 'contact_messages', v_contacts,
        'stripe_events', v_stripe, 'audit_entries', v_audit
      ));
    end if;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'cutoff', v_cutoff,
    'guests', v_guests,
    'guests_skipped', v_skipped,
    'external_events', v_events,
    'contact_messages', v_contacts,
    'email_logs', v_emails,
    'stripe_events', v_stripe,
    'audit_entries', v_audit,
    'total', v_guests + v_events + v_contacts + v_emails + v_stripe
  );
end;
$$;

-- `others` does not catch query_canceled, so a job stopped by a timeout used to
-- vanish without a failed row. The hold job leaves a row at most hourly when
-- nothing happens, so its age can be watched too.
create or replace function public.run_database_job(p_job text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_result integer;
  v_last public.job_runs;
begin
  insert into public.job_runs (job) values (p_job) returning id into v_id;
  begin
    v_result := case p_job
      when 'release_expired_holds' then public.release_expired_holds()
      when 'complete_finished_bookings' then public.complete_finished_bookings()
      when 'purge_admin_attempts' then public.purge_admin_attempts()
      when 'apply_retention' then (public.apply_retention(false) ->> 'total')::integer
    end;
    if v_result is null then
      raise exception 'unknown_job';
    end if;
    select * into v_last from public.job_runs
    where job = p_job and id < v_id order by id desc limit 1;
    if v_result = 0 and p_job = 'release_expired_holds'
      and v_last.status is distinct from 'failed'
      and v_last.started_at > now() - interval '1 hour'
    then
      delete from public.job_runs where id = v_id;
    else
      update public.job_runs
      set finished_at = now(), status = 'success', detail = v_result::text
      where id = v_id;
    end if;
  exception when others or query_canceled then
    update public.job_runs
    set finished_at = now(), status = 'failed', detail = sqlerrm
    where id = v_id;
  end;
end;
$$;

-- Holding the key-share lock until commit is what makes anonymise_guest wait
-- for this booking and then see it. If the row was erased while waiting, it no
-- longer matches, and a fresh guest is created.
create or replace function public.find_or_create_guest(p_guest jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := nullif(trim(p_guest ->> 'email'), '');
  v_id uuid;
begin
  for attempt in 1..3 loop
    -- Existing guests are never modified here: the caller is unauthenticated.
    insert into public.guests (email, full_name, phone, country, locale)
    values (
      v_email, p_guest ->> 'name', p_guest ->> 'phone', p_guest ->> 'country',
      coalesce(p_guest ->> 'locale', 'en')
    )
    on conflict (lower(email)) where email is not null and anonymized_at is null do nothing
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;

    select id into v_id from public.guests
    where lower(email) = lower(v_email) and anonymized_at is null
    for key share;
    if v_id is not null then
      return v_id;
    end if;
  end loop;
  raise exception 'guest_not_resolved';
end;
$$;

-- The lock comes first: the check must see what a concurrent call committed.
create or replace function public.assert_owner_actor(p_actor uuid) returns void
language plpgsql set search_path = '' as $$
begin
  -- Two Owners removing each other at once must not leave none.
  perform pg_advisory_xact_lock(hashtextextended('admin_profiles', 0));
  if not exists (
    select 1 from public.admin_profiles where id = p_actor and role = 'owner'
  ) then
    raise exception 'not_authorised';
  end if;
end;
$$;

-- Holds however the row is changed. An Owner can also reach this table through
-- RLS, so a check in the RPCs alone is not enough. The one exception is the
-- auth user itself being deleted, which only the dashboard does.
create function public.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'owner' or (tg_op = 'UPDATE' and new.role = 'owner') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.id) then
    return old;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin_profiles', 0));
  if not exists (
    select 1 from public.admin_profiles where role = 'owner' and id <> old.id
  ) then
    raise exception 'last_owner';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger admin_profiles_last_owner before delete or update of role
  on public.admin_profiles
  for each row execute function public.protect_last_owner();

-- Ends every sign-in of someone removed, reset or let back in, at once. Access
-- tokens that are already out expire by themselves within the hour, and a
-- removed admin has no role row to use them with.
create function public.delete_auth_sessions(p_user_id uuid, p_actor uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.set_actor(p_actor);
  perform public.assert_owner_actor(p_actor);
  if p_user_id = p_actor then
    raise exception 'cannot_change_self';
  end if;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.phone_keys(text[])',
    'public.matching_external_events(text[], text[])',
    'public.has_open_money(uuid[])',
    'public.scrub_personal_data(uuid[], uuid[], text[], text[])',
    'public.protect_last_owner()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  execute 'revoke all on function public.delete_auth_sessions(uuid, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.delete_auth_sessions(uuid, uuid) to service_role';
end;
$$;
