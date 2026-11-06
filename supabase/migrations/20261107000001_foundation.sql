-- Foundation: extensions, enums, admin roles, media, property, room, settings.
-- Translatable text is stored as jsonb keyed by locale, e.g. {"en": "...", "el": "..."}.

create extension if not exists btree_gist with schema extensions;

create type public.admin_role as enum ('owner', 'staff');
create type public.publish_status as enum ('draft', 'published');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.admin_role not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger admin_profiles_updated before update on public.admin_profiles
  for each row execute function public.set_updated_at();

-- Owner access requires a verified TOTP session (SUP-13). Owners without one
-- are treated as having no admin role, so MFA cannot be skipped by a client.
create function public.current_admin_role() returns public.admin_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.admin_profiles p
  where p.id = auth.uid()
    and (p.role <> 'owner' or coalesce(auth.jwt() ->> 'aal', '') = 'aal2');
$$;

create function public.is_admin() returns boolean
language sql stable set search_path = '' as $$
  select public.current_admin_role() is not null;
$$;

create function public.is_owner() returns boolean
language sql stable set search_path = '' as $$
  select public.current_admin_role() = 'owner';
$$;

create table public.media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media',
  path text not null,
  mime_type text not null,
  width integer,
  height integer,
  size_bytes bigint,
  alt jsonb not null default '{}' check (jsonb_typeof(alt) = 'object'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, path)
);
create trigger media_updated before update on public.media
  for each row execute function public.set_updated_at();

-- Where a photo appears. Replaces the spec's room_photos so every section of
-- the house has its own ordered collection (T4.24a).
create table public.media_placements (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  media_id uuid not null references public.media (id) on delete restrict,
  sort_order integer not null default 0,
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  unique (collection, media_id)
);
create index media_placements_order on public.media_placements (collection, sort_order);
create unique index media_placements_one_cover on public.media_placements (collection) where is_cover;

create table public.property (
  id boolean primary key default true check (id), -- single row
  name text not null,
  legal_name text,
  address text,
  phone text,
  email text,
  registration_number text,
  check_in_time time not null default '15:00',
  check_out_time time not null default '11:00',
  social_links jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger property_updated before update on public.property
  for each row execute function public.set_updated_at();

-- One row today (D1, whole house). Kept as a table so nothing assumes that.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  max_adults integer not null check (max_adults > 0),
  max_children integer not null default 0 check (max_children >= 0),
  base_occupancy integer not null check (base_occupancy > 0),
  base_price_cents integer not null check (base_price_cents >= 0),
  extra_guest_fee_cents integer not null default 0 check (extra_guest_fee_cents >= 0),
  cleaning_fee_cents integer not null default 0 check (cleaning_fee_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger rooms_updated before update on public.rooms
  for each row execute function public.set_updated_at();

create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  icon text,
  sort_order integer not null default 0
);

create table public.room_amenities (
  room_id uuid not null references public.rooms (id) on delete cascade,
  amenity_id uuid not null references public.amenities (id) on delete cascade,
  primary key (room_id, amenity_id)
);

-- Rules Yorgos edits in Admin (D6) live here, never in code.
create table public.settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger settings_updated before update on public.settings
  for each row execute function public.set_updated_at();
