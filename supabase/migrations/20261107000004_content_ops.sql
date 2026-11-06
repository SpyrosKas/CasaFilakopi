-- CMS content, messages, email, audit and operations.

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title jsonb not null default '{}' check (jsonb_typeof(title) = 'object'),
  seo jsonb not null default '{}' check (jsonb_typeof(seo) = 'object'),
  status public.publish_status not null default 'draft',
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger pages_updated before update on public.pages
  for each row execute function public.set_updated_at();

-- draft and published sit side by side. Public roles get a column grant on
-- published only, so unpublished text cannot be read (ADM-19).
create table public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.pages (id) on delete cascade,
  key text not null,
  draft jsonb not null default '{}',
  published jsonb,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (page_id, key)
);
create trigger content_blocks_updated before update on public.content_blocks
  for each row execute function public.set_updated_at();

create table public.faq (
  id uuid primary key default gen_random_uuid(),
  question jsonb not null check (jsonb_typeof(question) = 'object'),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  status public.publish_status not null default 'draft',
  sort_order integer not null default 0
);

create table public.testimonials (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  status public.publish_status not null default 'draft',
  sort_order integer not null default 0
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{}' check (jsonb_typeof(description) = 'object'),
  media_id uuid references public.media (id) on delete restrict,
  status public.publish_status not null default 'draft',
  sort_order integer not null default 0
);

create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  dates_of_interest text,
  message text not null,
  locale text not null default 'en',
  booking_id uuid references public.bookings (id) on delete set null,
  status text not null default 'new' check (status in ('new', 'replied', 'archived')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index contact_messages_created on public.contact_messages (created_at desc);

create table public.email_templates (
  key text not null,
  locale text not null,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (key, locale)
);
create trigger email_templates_updated before update on public.email_templates
  for each row execute function public.set_updated_at();

-- Queue and log in one table: a row is an email from queued to delivered.
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  recipient text not null,
  locale text not null default 'en',
  payload jsonb not null default '{}',
  booking_id uuid references public.bookings (id) on delete set null,
  contact_message_id uuid references public.contact_messages (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  resend_id text unique,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_logs_queue on public.email_logs (next_attempt_at) where status = 'queued';
create index email_logs_booking on public.email_logs (booking_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity on public.audit_log (entity, entity_id);
create index audit_log_created on public.audit_log (created_at desc);

create table public.consent_log (
  id bigint generated always as identity primary key,
  kind text not null,
  subject text,
  policy_version text,
  granted boolean not null,
  created_at timestamptz not null default now()
);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  detail text
);
create index job_runs_job on public.job_runs (job, started_at desc);

-- Change history. Column arguments are left out of the stored snapshot, which
-- keeps guest contact details out of the audit log and simplifies GDPR erasure.
create function public.audit_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- tg_argv is NULL with no arguments, and jsonb - NULL is NULL.
  redact text[] := coalesce(tg_argv, '{}');
  -- RPCs run under the secret key, where auth.uid() is NULL (see set_actor).
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
  row_before jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - redact end;
  row_after jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - redact end;
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    actor, lower(tg_op), tg_table_name,
    coalesce(row_after, row_before) ->> (
      case when tg_table_name = 'settings' then 'key' else 'id' end
    ),
    row_before, row_after
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_bookings after insert or update or delete on public.bookings
  for each row execute function public.audit_change(
    'guest_name', 'guest_email', 'guest_phone', 'guest_country',
    'special_requests', 'internal_notes', 'access_token_hash'
  );
create trigger audit_blocks after insert or update or delete on public.availability_blocks
  for each row execute function public.audit_change();
create trigger audit_restrictions after insert or update or delete on public.restrictions
  for each row execute function public.audit_change();
create trigger audit_seasons after insert or update or delete on public.seasons
  for each row execute function public.audit_change();
create trigger audit_rooms after insert or update or delete on public.rooms
  for each row execute function public.audit_change();
create trigger audit_settings after insert or update or delete on public.settings
  for each row execute function public.audit_change();
create trigger audit_policies after insert or update or delete on public.cancellation_policies
  for each row execute function public.audit_change();
create trigger audit_promos after insert or update or delete on public.promo_codes
  for each row execute function public.audit_change();
create trigger audit_fees after insert or update or delete on public.taxes_fees
  for each row execute function public.audit_change();
create trigger audit_admins after insert or update or delete on public.admin_profiles
  for each row execute function public.audit_change();
