-- Only one open balance payment per booking, so a guest cannot have two live
-- payment pages for the same money.
create unique index payments_one_pending on public.payments (booking_id) where status = 'pending';
