-- Scheduled jobs (D9, T4.32). Database jobs run by themselves. Jobs that call
-- the site read `site_url` and `cron_secret` from Vault, set per environment:
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--   select vault.create_secret('https://<host>', 'site_url');
-- Until both exist, those jobs do nothing.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.call_cron_route(p_path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 55000
  );
end;
$$;

create function public.run_database_job(p_job text) returns void
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
    end;
    if v_result is null then
      raise exception 'unknown_job';
    end if;
    -- A quiet minute leaves no trace, so the log stays readable.
    if v_result = 0 and p_job = 'release_expired_holds' then
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

revoke all on function public.call_cron_route(text) from public, anon, authenticated;
revoke all on function public.run_database_job(text) from public, anon, authenticated;
grant execute on function public.call_cron_route(text), public.run_database_job(text) to service_role;

select cron.schedule('release-expired-holds', '* * * * *', $$select public.run_database_job('release_expired_holds')$$);
select cron.schedule('complete-finished-bookings', '17 1 * * *', $$select public.run_database_job('complete_finished_bookings')$$);
select cron.schedule('purge-admin-attempts', '23 2 * * *', $$select public.run_database_job('purge_admin_attempts')$$);
select cron.schedule('channel-sync', '*/5 * * * *', $$select public.call_cron_route('/api/cron/channel-sync')$$);
select cron.schedule('email-queue', '* * * * *', $$select public.call_cron_route('/api/cron/email')$$);
select cron.schedule('email-scheduled', '11 * * * *', $$select public.call_cron_route('/api/cron/email/scheduled')$$);
select cron.schedule('cms-cleanup', '37 3 * * *', $$select public.call_cron_route('/api/cron/cms')$$);
