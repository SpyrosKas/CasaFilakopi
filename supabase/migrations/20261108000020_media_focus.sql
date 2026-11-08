-- The spot in a photo that every frame keeps in view (T6.18). Percent from the
-- left and from the top. Null means the centre, which is how a photographer
-- frames most shots. Yorgos sets it in Text and photos by tapping the photo.
alter table public.media
  add column focus_x smallint check (focus_x between 0 and 100),
  add column focus_y smallint check (focus_y between 0 and 100),
  add constraint media_focus_pair check ((focus_x is null) = (focus_y is null));

-- Migration 19 grants anon named columns only; the site needs these two.
grant select (focus_x, focus_y) on public.media to anon;
