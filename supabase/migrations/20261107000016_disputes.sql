-- Card disputes, called from the verified Stripe webhook. Safe to repeat.

create function public.open_dispute(p_payment_intent_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments
  where stripe_payment_intent_id = p_payment_intent_id;
  if not found then
    return jsonb_build_object('outcome', 'unknown');
  end if;

  perform 1 from public.bookings where id = v_payment.booking_id for update;
  select * into v_payment from public.payments where id = v_payment.id for update;
  if v_payment.status = 'disputed' then
    return jsonb_build_object('outcome', 'already_open', 'booking_id', v_payment.booking_id);
  end if;

  update public.payments set status = 'disputed' where id = v_payment.id;
  return jsonb_build_object('outcome', 'opened', 'booking_id', v_payment.booking_id);
end;
$$;

-- A lost dispute is recorded like a refund, because the money has gone. The
-- dispute id as stripe_refund_id makes a replay safe.
create function public.close_dispute(
  p_payment_intent_id text,
  p_dispute_id text,
  p_won boolean,
  p_amount_cents integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments
  where stripe_payment_intent_id = p_payment_intent_id;
  if not found then
    return jsonb_build_object('outcome', 'unknown');
  end if;

  perform 1 from public.bookings where id = v_payment.booking_id for update;
  update public.payments set status = 'succeeded'
  where id = v_payment.id and status = 'disputed';

  if not p_won then
    insert into public.refunds (
      booking_id, payment_id, amount_cents, status, reason, stripe_refund_id
    ) values (
      v_payment.booking_id, v_payment.id, p_amount_cents, 'succeeded', 'Dispute lost', p_dispute_id
    ) on conflict (stripe_refund_id) do nothing;
  end if;

  perform public.sync_refunded_status(v_payment.booking_id);
  return jsonb_build_object(
    'outcome', case when p_won then 'won' else 'lost' end,
    'booking_id', v_payment.booking_id
  );
end;
$$;

revoke all on function public.open_dispute(text) from public, anon, authenticated;
revoke all on function public.close_dispute(text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.open_dispute(text), public.close_dispute(text, text, boolean, integer) to service_role;

select cron.schedule('payments', '*/5 * * * *', $$select public.call_cron_route('/api/cron/payments')$$);
