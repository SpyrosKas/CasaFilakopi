-- Fixes from the ADMIN security review. Controls that lived only in the app
-- are moved here, because Supabase Auth and PostgREST are reachable directly.

-- Staff who turned MFA on must use it. Before this, a stolen Staff password
-- reached guest data at aal1 by calling the API directly.
create or replace function public.current_admin_role() returns public.admin_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.admin_profiles p
  where p.id = auth.uid()
    and (
      coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or (
        p.role <> 'owner'
        and not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = p.id and f.status = 'verified'
        )
      )
    );
$$;

-- Login and reset attempts. Kept out of audit_log so anonymous traffic cannot
-- bury the Owner's history. Reachable only with the secret key.
create table public.admin_attempts (
  id bigint generated always as identity primary key,
  scope text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index admin_attempts_lookup on public.admin_attempts (scope, key_hash, created_at desc);
create index admin_attempts_created on public.admin_attempts (created_at);
alter table public.admin_attempts enable row level security;
alter table public.admin_attempts force row level security;
revoke all on public.admin_attempts from anon, authenticated;

delete from public.audit_log where entity = 'admin_attempt';

create function public.purge_admin_attempts(p_older_than interval default interval '7 days')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from public.admin_attempts where created_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Payment rules and refund tiers are one decision, so they save as one step.
-- Called after the server has checked the caller is the Owner.
create function public.save_rules(
  p_payment jsonb,
  p_tiers jsonb,
  p_is_non_refundable boolean,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  -- Two saves cannot interleave and leave one's tiers with the other's payment.
  perform pg_advisory_xact_lock(hashtextextended('save_rules', 0));

  insert into public.settings (key, value, is_public)
  values ('payment', p_payment, false)
  on conflict (key) do update set value = excluded.value;

  update public.cancellation_policies
  set tiers = p_tiers, is_non_refundable = p_is_non_refundable, is_active = true
  where is_default;

  if not found then
    insert into public.cancellation_policies (name, tiers, is_non_refundable, is_default)
    values ('{"en": "Standard", "el": "Τυπική"}', p_tiers, p_is_non_refundable, true);
  end if;
end;
$$;

revoke all on function public.purge_admin_attempts(interval) from public, anon, authenticated;
revoke all on function public.save_rules(jsonb, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.purge_admin_attempts(interval) to service_role;
grant execute on function public.save_rules(jsonb, jsonb, boolean, uuid) to service_role;

create trigger audit_property after insert or update or delete on public.property
  for each row execute function public.audit_change();
