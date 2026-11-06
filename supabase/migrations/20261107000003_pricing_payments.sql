-- Rates, restrictions, fees, payments and invoicing tables.

create type public.fee_kind as enum ('percent', 'per_stay', 'per_night', 'per_guest_night');
create type public.promo_kind as enum ('percent', 'fixed');
create type public.payment_method as enum ('card', 'cash', 'bank_transfer', 'pos');
create type public.payment_kind as enum ('full', 'deposit', 'balance', 'extra');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'disputed');
create type public.refund_status as enum ('pending', 'succeeded', 'failed');
create type public.invoice_doc_type as enum ('receipt', 'invoice', 'credit_note');
create type public.invoice_status as enum ('draft', 'issued');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null, -- inclusive
  nightly_cents integer not null check (nightly_cents >= 0),
  weekend_cents integer check (weekend_cents >= 0),
  check (end_date >= start_date),
  constraint no_overlapping_seasons exclude using gist (
    room_id with =, daterange(start_date, end_date, '[]') with &&
  )
);

create table public.rate_overrides (
  room_id uuid not null references public.rooms (id) on delete cascade,
  night date not null,
  nightly_cents integer not null check (nightly_cents >= 0),
  primary key (room_id, night)
);

create table public.restrictions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  start_date date not null,
  end_date date not null, -- inclusive
  min_stay integer check (min_stay > 0),
  max_stay integer check (max_stay > 0),
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  allowed_check_in_days integer[], -- 0 = Sunday
  check (end_date >= start_date),
  check (max_stay is null or min_stay is null or max_stay >= min_stay)
);
create index restrictions_room on public.restrictions (room_id, start_date, end_date);

create table public.taxes_fees (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  kind public.fee_kind not null,
  amount_cents integer check (amount_cents >= 0),
  rate_basis_points integer check (rate_basis_points >= 0),
  is_vat boolean not null default false,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  check ((kind = 'percent') = (rate_basis_points is not null)),
  check ((kind = 'percent') = (amount_cents is null))
);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind public.promo_kind not null,
  value integer not null check (value > 0), -- basis points or cents
  valid_from date,
  valid_to date,
  max_uses integer check (max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  room_ids uuid[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index promo_codes_code on public.promo_codes (lower(code));

create table public.cancellation_policies (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  -- [{"daysBefore": 30, "refundPercent": 100}, ...]
  tiers jsonb not null check (jsonb_typeof(tiers) = 'array'),
  is_non_refundable boolean not null default false,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cancellation_policies_one_default on public.cancellation_policies (is_default) where is_default;
create trigger cancellation_policies_updated before update on public.cancellation_policies
  for each row execute function public.set_updated_at();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  kind public.payment_kind not null,
  method public.payment_method not null,
  status public.payment_status not null,
  amount_cents integer not null check (amount_cents > 0),
  stripe_payment_intent_id text unique,
  stripe_checkout_session_id text unique,
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_booking on public.payments (booking_id);
create trigger payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  payment_id uuid not null references public.payments (id),
  amount_cents integer not null check (amount_cents > 0),
  status public.refund_status not null,
  reason text,
  stripe_refund_id text unique,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index refunds_booking on public.refunds (booking_id);
create trigger refunds_updated before update on public.refunds
  for each row execute function public.set_updated_at();

-- Each Stripe event is handled once (PAY-04).
create table public.stripe_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

-- Invoicing tables only. Issuing logic waits for the accountant (D4).
create table public.invoice_series (
  id uuid primary key default gen_random_uuid(),
  doc_type public.invoice_doc_type not null,
  prefix text not null,
  last_number integer not null default 0 check (last_number >= 0),
  is_active boolean not null default true,
  unique (doc_type, prefix)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id),
  series_id uuid references public.invoice_series (id),
  number integer,
  doc_type public.invoice_doc_type not null,
  status public.invoice_status not null default 'draft',
  credits_invoice_id uuid references public.invoices (id),
  issuer jsonb not null default '{}',
  customer jsonb not null default '{}',
  total_cents integer not null default 0,
  vat_cents integer not null default 0,
  payment_method public.payment_method,
  pdf_path text,
  mydata jsonb,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  unique (series_id, number),
  check (status = 'draft' or (series_id is not null and number is not null and issued_at is not null)),
  check ((doc_type = 'credit_note') = (credits_invoice_id is not null))
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  description text not null,
  quantity numeric not null default 1,
  unit_cents integer not null,
  vat_basis_points integer not null default 0,
  total_cents integer not null,
  sort_order integer not null default 0
);
create index invoice_lines_invoice on public.invoice_lines (invoice_id);

-- Issued documents are immutable (INV-07).
create function public.protect_issued_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      raise exception 'issued_invoice_immutable';
    end if;
    return old;
  end if;
  if old.status = 'issued' and (
    to_jsonb(new) - array['pdf_path', 'mydata'] is distinct from to_jsonb(old) - array['pdf_path', 'mydata']
  ) then
    raise exception 'issued_invoice_immutable';
  end if;
  return new;
end;
$$;
create trigger invoices_immutable before update or delete on public.invoices
  for each row execute function public.protect_issued_invoice();

create function public.protect_issued_invoice_lines() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.invoices i
    where i.id in (old.invoice_id, new.invoice_id) and i.status = 'issued'
  ) then
    raise exception 'issued_invoice_immutable';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_immutable before insert or update or delete on public.invoice_lines
  for each row execute function public.protect_issued_invoice_lines();
