-- Change history for content and photos. Autosaved drafts are not recorded:
-- only published text counts as a change people need to trace.
create trigger audit_pages after insert or update or delete on public.pages
  for each row execute function public.audit_change();
create trigger audit_content_published after update on public.content_blocks
  for each row when (old.published is distinct from new.published)
  execute function public.audit_change('draft');
create trigger audit_media after insert or update or delete on public.media
  for each row execute function public.audit_change();
create trigger audit_media_placements after insert or delete on public.media_placements
  for each row execute function public.audit_change();
create trigger audit_faq after insert or update or delete on public.faq
  for each row execute function public.audit_change();
create trigger audit_testimonials after insert or update or delete on public.testimonials
  for each row execute function public.audit_change();
create trigger audit_places after insert or update or delete on public.places
  for each row execute function public.audit_change();
