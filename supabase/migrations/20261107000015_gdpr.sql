-- GDPR erasure and retention (T5.10, JOB-08), user management (T5.11) and job
-- health (JOB-09). Invoices are immutable tax records and are never touched:
-- nothing here writes to invoices or invoice_lines.

-- How long guest data stays. Confirm with the accountant (D27, question 15).
insert into public.settings (key, value, is_public)
values ('retention', '{"years": 5}', false)
on conflict (key) do nothing;

-- The next import must not bring back a name already erased.
alter table public.external_events add column anonymized_at timestamptz;

create or replace function public.upsert_external_event(
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
    set start_date = excluded.start_date, end_date = excluded.end_date,
        summary = case
          when public.external_events.anonymized_at is null then excluded.summary
        end
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

create function public.only_digits(p_text text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(p_text, ''), '[^0-9]', '', 'g'), '');
$$;

-- True when the text contains any of these lower-case strings. Plain position,
-- not ilike, so a % or _ in a name means nothing.
create function public.mentions(p_text text, p_needles text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_text, '') <> '' and exists (
    select 1 from unnest(p_needles) n where position(n in lower(p_text)) > 0
  );
$$;

-- Lower-case strings that identify a person. Short names are left out, because
-- "Al" would match half the log.
create function public.identity_needles(
  p_emails text[], p_phones text[], p_names text[]
) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct n), '{}') from (
    select lower(trim(e)) as n from unnest(p_emails) e
    union select lower(trim(p)) from unnest(p_phones) p
    union select public.only_digits(p) from unnest(p_phones) p
    union select lower(trim(x)) from unnest(p_names) x
  ) s
  where n is not null and length(n) >= 4;
$$;

-- Imported stays carry no guest id, only what Yorgos typed and what the feed
-- said, so they are found by what is known about the person.
create function public.matching_external_events(
  p_emails text[], p_phones text[], p_names text[]
) returns setof public.external_events
language sql stable set search_path = '' as $$
  select e.* from public.external_events e
  where lower(trim(e.guest_email)) = any (p_emails)
    or public.only_digits(e.guest_phone) = any (
      select public.only_digits(p) from unnest(p_phones) p
    )
    or lower(trim(e.guest_name)) = any (p_names)
    or public.mentions(
      concat_ws(' ', e.summary, e.guest_notes),
      public.identity_needles(p_emails, p_phones, p_names)
    );
$$;

-- Everything except the guests row. Checks and the audit entry belong to the
-- callers. Keeps what the books need: dates, amounts, statuses and references.
create function public.scrub_personal_data(
  p_booking_ids uuid[],
  p_event_ids uuid[],
  p_emails text[],
  p_phones text[],
  p_names text[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_needles text[] := public.identity_needles(p_emails, p_phones, p_names);
  v_refs text[];
  v_contact_ids uuid[];
  v_emails integer;
  v_stripe integer;
  v_audit integer;
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
      or public.mentions(concat_ws(' ', name, phone, dates_of_interest, message), v_needles)
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_contact_ids from hit;

  -- Anything still waiting would go to an address that is gone.
  update public.email_logs
  set recipient = 'anonymised', payload = '{}', last_error = null,
      status = case when status in ('queued', 'sending') then 'failed' else status end
  where booking_id = any (p_booking_ids)
    or contact_message_id = any (v_contact_ids)
    or lower(trim(recipient)) = any (p_emails)
    or public.mentions(payload::text, v_needles)
    or public.mentions(last_error, v_needles);
  get diagnostics v_emails = row_count;

  -- Lower-cased, because mentions() compares lower-case: Stripe ids are mixed.
  select coalesce(array_agg(lower(r)), '{}') into v_refs from (
    select b::text as r from unnest(p_booking_ids) b
    union select stripe_payment_intent_id from public.payments
      where booking_id = any (p_booking_ids) and stripe_payment_intent_id is not null
    union select stripe_checkout_session_id from public.payments
      where booking_id = any (p_booking_ids) and stripe_checkout_session_id is not null
    union select stripe_checkout_session_id from public.holds
      where booking_id = any (p_booking_ids) and stripe_checkout_session_id is not null
  ) s;

  update public.stripe_events
  set payload = '{"anonymised": true}', error = null
  where public.mentions(payload::text, v_refs || v_needles)
    or public.mentions(error, v_needles);
  get diagnostics v_stripe = row_count;

  -- The triggers already leave out contact fields; these two were never left
  -- out, and a free-text field can hold a name.
  update public.audit_log
  set before = before - array['arrival_time', 'cancellation_reason'],
      after = after - array['arrival_time', 'cancellation_reason']
  where entity = 'bookings'
    and entity_id = any (select b::text from unnest(p_booking_ids) b);

  update public.audit_log
  set before = before - 'summary', after = after - 'summary'
  where entity = 'external_events'
    and entity_id = any (select e::text from unnest(p_event_ids) e);

  update public.audit_log
  set before = null, after = null
  where public.mentions(before::text, v_needles) or public.mentions(after::text, v_needles);
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'bookings', coalesce(cardinality(p_booking_ids), 0),
    'external_events', coalesce(cardinality(p_event_ids), 0),
    'contact_messages', cardinality(v_contact_ids),
    'email_logs', v_emails,
    'stripe_events', v_stripe,
    'audit_entries', v_audit
  );
end;
$$;

-- Today at the house, as business logic counts it.
create function public.house_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Athens')::date;
$$;

-- Erases one guest. Refused while a stay is current or to come. Safe to repeat.
create function public.anonymise_guest(p_guest_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guest public.guests;
  v_booking_ids uuid[];
  v_event_ids uuid[];
  v_emails text[];
  v_phones text[];
  v_names text[];
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
    coalesce(array_agg(distinct x.phone) filter (where x.phone is not null), '{}'),
    coalesce(array_agg(distinct x.name) filter (where x.name is not null), '{}')
  into v_emails, v_phones, v_names
  from (
    select nullif(lower(trim(v_guest.email)), '') as email,
           nullif(trim(v_guest.phone), '') as phone,
           nullif(lower(trim(v_guest.full_name)), '') as name
    union all
    select nullif(lower(trim(b.guest_email)), ''), nullif(trim(b.guest_phone), ''),
           nullif(lower(trim(b.guest_name)), '')
    from public.bookings b where b.id = any (v_booking_ids)
  ) x;

  if exists (
    select 1 from public.bookings
    where id = any (v_booking_ids)
      and status in ('pending_payment', 'confirmed', 'checked_in')
      and check_out >= public.house_today()
  ) or exists (
    select 1 from public.matching_external_events(v_emails, v_phones, v_names)
    where end_date >= public.house_today()
  ) then
    raise exception 'guest_has_stay';
  end if;

  select coalesce(array_agg(id), '{}') into v_event_ids
  from public.matching_external_events(v_emails, v_phones, v_names);

  update public.guests
  set email = null, full_name = null, phone = null, country = null,
      marketing_consent = false, anonymized_at = now()
  where id = p_guest_id;

  v_counts := public.scrub_personal_data(
    v_booking_ids, v_event_ids, v_emails, v_phones, v_names
  );

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'anonymise', 'guests', p_guest_id::text, v_counts);
  return v_counts;
end;
$$;

-- A guest known only from an imported stay has no guests row (D19).
create function public.anonymise_external_guest(p_event_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.external_events;
  v_event_ids uuid[];
  v_emails text[];
  v_phones text[];
  v_names text[];
  v_counts jsonb;
begin
  perform public.set_actor(p_actor);
  select * into v_event from public.external_events where id = p_event_id;
  if not found then
    raise exception 'guest_not_found';
  end if;

  v_emails := array_remove(array[nullif(lower(trim(v_event.guest_email)), '')], null);
  v_phones := array_remove(array[nullif(trim(v_event.guest_phone), '')], null);
  v_names := array_remove(array[nullif(lower(trim(v_event.guest_name)), '')], null);

  if exists (
    select 1 from public.matching_external_events(v_emails, v_phones, v_names)
    where end_date >= public.house_today()
  ) or v_event.end_date >= public.house_today() then
    raise exception 'guest_has_stay';
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_event_ids from (
    select id from public.matching_external_events(v_emails, v_phones, v_names)
    union select p_event_id
  ) s;

  v_counts := public.scrub_personal_data('{}', v_event_ids, v_emails, v_phones, v_names);

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (p_actor, 'anonymise', 'external_events', p_event_id::text, v_counts);
  return v_counts;
end;
$$;

-- JOB-08. A dry run counts the same rows and changes nothing, and it is the
-- default, so nobody erases data by calling this without meaning to.
create function public.apply_retention(p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_years integer;
  v_cutoff date;
  v_guest uuid;
  v_guests integer := 0;
  v_skipped integer := 0;
  v_events integer;
  v_contacts integer;
  v_emails integer;
  v_stripe integer;
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
      -- The same person may have an imported stay still to come. Their turn
      -- comes later. Anything else is a real fault and fails the job.
      if sqlerrm <> 'guest_has_stay' then
        raise;
      end if;
      v_skipped := v_skipped + 1;
    end;
  end loop;

  if p_dry_run then
    select count(*) into v_events from public.external_events
    where end_date < v_cutoff and anonymized_at is null;
    select count(*) into v_contacts from public.contact_messages
    where created_at < v_cutoff;
    select count(*) into v_emails from public.email_logs
    where created_at < v_cutoff;
    select count(*) into v_stripe from public.stripe_events
    where received_at < v_cutoff and payload <> '{"anonymised": true}';
  else
    update public.external_events
    set summary = null, guest_name = null, guest_email = null, guest_phone = null,
        guest_notes = null, anonymized_at = now()
    where end_date < v_cutoff and anonymized_at is null;
    get diagnostics v_events = row_count;

    delete from public.email_logs where created_at < v_cutoff;
    get diagnostics v_emails = row_count;

    delete from public.contact_messages where created_at < v_cutoff;
    get diagnostics v_contacts = row_count;

    update public.stripe_events
    set payload = '{"anonymised": true}', error = null
    where received_at < v_cutoff and payload <> '{"anonymised": true}';
    get diagnostics v_stripe = row_count;

    if v_guests + v_events + v_emails + v_contacts + v_stripe > 0 then
      insert into public.audit_log (action, entity, after)
      values ('retention', 'guests', jsonb_build_object(
        'guests', v_guests, 'external_events', v_events, 'email_logs', v_emails,
        'contact_messages', v_contacts, 'stripe_events', v_stripe
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
    'total', v_guests + v_events + v_contacts + v_emails + v_stripe
  );
end;
$$;

create or replace function public.run_database_job(p_job text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_result integer;
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
    -- A quiet minute leaves no trace, so the log stays readable. The first
    -- quiet run after a failure stays, or the failure would look current forever.
    if v_result = 0 and p_job = 'release_expired_holds' and coalesce((
      select status <> 'failed' from public.job_runs
      where job = p_job and id < v_id order by id desc limit 1
    ), true) then
      delete from public.job_runs where id = v_id;
    else
      update public.job_runs
      set finished_at = now(), status = 'success', detail = v_result::text
      where id = v_id;
    end if;
  exception when others then
    update public.job_runs
    set finished_at = now(), status = 'failed', detail = sqlerrm
    where id = v_id;
  end;
end;
$$;

-- User management (T5.11). Accounts live in Supabase Auth; these change the
-- role row, with the checks that must hold however the app calls them.
create function public.assert_owner_actor(p_actor uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.admin_profiles where id = p_actor and role = 'owner'
  ) then
    raise exception 'not_authorised';
  end if;
  -- Two Owners removing each other at once must not leave none.
  perform pg_advisory_xact_lock(hashtextextended('admin_profiles', 0));
end;
$$;

create function public.add_admin(
  p_user_id uuid,
  p_role public.admin_role,
  p_display_name text,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  perform public.assert_owner_actor(p_actor);
  insert into public.admin_profiles (id, role, display_name)
  values (p_user_id, p_role, p_display_name);
end;
$$;

create function public.change_admin_role(
  p_user_id uuid,
  p_role public.admin_role,
  p_actor uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  perform public.assert_owner_actor(p_actor);
  if p_user_id = p_actor then
    raise exception 'cannot_change_self';
  end if;
  update public.admin_profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'admin_not_found';
  end if;
end;
$$;

-- The auth account stays, disabled by the caller: deleting it would rewrite
-- issued_by on immutable invoices.
create function public.remove_admin(p_user_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  perform public.assert_owner_actor(p_actor);
  if p_user_id = p_actor then
    raise exception 'cannot_change_self';
  end if;
  delete from public.admin_profiles where id = p_user_id;
  if not found then
    raise exception 'admin_not_found';
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.only_digits(text)',
    'public.mentions(text, text[])',
    'public.identity_needles(text[], text[], text[])',
    'public.matching_external_events(text[], text[], text[])',
    'public.scrub_personal_data(uuid[], uuid[], text[], text[], text[])',
    'public.house_today()',
    'public.assert_owner_actor(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;

  foreach f in array array[
    'public.anonymise_guest(uuid, uuid)',
    'public.anonymise_external_guest(uuid, uuid)',
    'public.apply_retention(boolean)',
    'public.add_admin(uuid, public.admin_role, text, uuid)',
    'public.change_admin_role(uuid, public.admin_role, uuid)',
    'public.remove_admin(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

select cron.schedule('gdpr-retention', '41 2 * * *', $$select public.run_database_job('apply_retention')$$);
-- Reads job_runs, emails the host about repeated failures, and is the heartbeat
-- Home uses to tell that the site's jobs are running (JOB-09).
select cron.schedule('job-health', '13 * * * *', $$select public.call_cron_route('/api/cron/health')$$);
