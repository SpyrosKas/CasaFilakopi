-- Import links are secrets. Signed-in sessions lose the column, and the Owner's
-- screens reach it through the server after a role check.
revoke select on public.external_calendars from authenticated;
grant select (id, room_id, channel, is_enabled, last_synced_at, consecutive_failures, created_at, updated_at)
  on public.external_calendars to authenticated;
