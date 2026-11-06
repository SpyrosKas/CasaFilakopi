-- Bookings and inventory. Every occupied date owns exactly one row in
-- inventory_claims, the only table holding the overbooking constraint.

create type public.booking_status as enum (
  'pending_payment', 'confirmed', 'checked_in', 'completed',
  'cancelled', 'expired', 'refunded', 'no_show'
);
create type public.booking_source as enum ('direct', 'manual', 'booking_com', 'airbnb', 'other');
create type public.claim_kind as enum ('hold', 'booking', 'block', 'external');
create type public.block_reason as enum ('maintenance', 'owner_use', 'closed_period', 'other');
create type public.channel as enum ('airbnb', 'booking_com', 'other_ical');

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  email text,
  full_name text,
  phone text,
  country text,
  locale text not null default 'en',
  marketing_consent boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index guests_email_unique on public.guests (lower(email))
  where email is not null and anonymized_at is null;
create trigger guests_updated before update on public.guests
  for each row execute function public.set_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique, -- assigned at confirmation (BKG-13)
  room_id uuid not null references public.rooms (id),
  guest_id uuid not null references public.guests (id),
  status public.booking_status not null default 'pending_payment',
  source public.booking_source not null default 'direct',
  check_in date not null,
  check_out date not null,
  adults integer not null check (adults > 0),
  children integer not null default 0 check (children >= 0),
  -- Contact as given on this booking. A guest typing an existing email must
  -- never change that guest's stored details.
  guest_name text,
  guest_email text,
  guest_phone text,
  guest_country text,
  locale text not null default 'en',
  arrival_time text,
  special_requests text,
  internal_notes text,
  currency text not null default 'EUR' check (currency = 'EUR'),
  price_breakdown jsonb not null,
  total_cents integer not null check (total_cents >= 0),
  due_now_cents integer not null check (due_now_cents >= 0),
  -- Rules agreed at booking time. Later Admin edits never reach these (D6).
  rules_snapshot jsonb not null,
  promo_code text,
  marketing_consent boolean not null default false,
  terms_version text,
  terms_accepted_at timestamptz,
  access_token_hash text unique,
  access_token_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in),
  check (due_now_cents <= total_cents)
);
create index bookings_guest on public.bookings (guest_id);
create index bookings_stay on public.bookings (check_in, check_out);
create index bookings_status on public.bookings (status);
create trigger bookings_updated before update on public.bookings
  for each row execute function public.set_updated_at();

create table public.holds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  expires_at timestamptz not null,
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now()
);
create index holds_expiry on public.holds (expires_at);

create table public.availability_blocks (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  start_date date not null,
  end_date date not null, -- exclusive, like check_out
  reason public.block_reason not null,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date > start_date)
);

create table public.external_calendars (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  channel public.channel not null,
  import_url text,
  is_enabled boolean not null default false,
  last_synced_at timestamptz,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, channel)
);
create trigger external_calendars_updated before update on public.external_calendars
  for each row execute function public.set_updated_at();

create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.external_calendars (id) on delete cascade,
  uid text not null,
  start_date date not null,
  end_date date not null,
  summary text,
  guest_name text,
  guest_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, uid),
  check (end_date > start_date)
);
create trigger external_events_updated before update on public.external_events
  for each row execute function public.set_updated_at();

create table public.ical_export_tokens (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  token_hash text not null unique,
  rotated_at timestamptz not null default now()
);

create table public.sync_logs (
  id bigint generated always as identity primary key,
  calendar_id uuid not null references public.external_calendars (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  events_seen integer,
  error text
);
create index sync_logs_calendar on public.sync_logs (calendar_id, started_at desc);

create table public.inventory_claims (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id),
  stay daterange not null,
  kind public.claim_kind not null,
  booking_id uuid unique references public.bookings (id) on delete cascade,
  block_id uuid unique references public.availability_blocks (id) on delete cascade,
  external_event_id uuid unique references public.external_events (id) on delete cascade,
  -- An imported event that collides is stored and flagged, not rejected
  -- (CHN-13), so it sits outside the constraint below.
  is_conflicted boolean not null default false,
  created_at timestamptz not null default now(),
  check (not isempty(stay) and not lower_inf(stay) and not upper_inf(stay)),
  check (is_conflicted = false or kind = 'external'),
  check (
    (kind in ('hold', 'booking') and booking_id is not null and block_id is null and external_event_id is null)
    or (kind = 'block' and block_id is not null and booking_id is null and external_event_id is null)
    or (kind = 'external' and external_event_id is not null and booking_id is null and block_id is null)
  ),
  -- SUP-04: overlaps are impossible even under concurrent requests.
  constraint no_overlapping_claims exclude using gist (room_id with =, stay with &&)
    where (not is_conflicted)
);
create index inventory_claims_stay on public.inventory_claims using gist (stay);

create table public.booking_reference_counters (
  year integer primary key,
  last_value integer not null default 0
);
