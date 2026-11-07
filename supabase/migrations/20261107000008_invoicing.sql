-- Invoice issuing (D17). Built before the accountant's answers: document types,
-- VAT and series are data, and every document stays provisional until the
-- 'invoicing' setting says otherwise. myDATA is Off: the accountant uploads.

alter table public.invoices
  add column payment_id uuid references public.payments (id),
  -- Stored at issue, so a document's number can never drift from its PDF.
  add column document_number text unique,
  add column is_provisional boolean not null default true,
  add column net_cents integer not null default 0,
  add column fee_cents integer not null default 0,
  add column reason text,
  add column exported_at timestamptz,
  add column issued_by uuid references auth.users (id) on delete set null;

alter table public.invoice_lines
  add column kind text not null default 'accommodation'
    check (kind in ('accommodation', 'extra_guest', 'cleaning', 'fee', 'discount', 'deposit', 'balance', 'other')),
  add column vat_cents integer not null default 0;

create index invoices_issued on public.invoices (issued_at desc);
create index invoices_booking on public.invoices (booking_id);
create index invoices_payment on public.invoices (payment_id);
-- One document per payment, so a replayed Stripe event cannot issue a second.
create unique index invoices_one_per_payment on public.invoices (payment_id)
  where payment_id is not null and doc_type <> 'credit_note';

-- Exactly one active series per document type, so numbering cannot jump.
create unique index invoice_series_one_active on public.invoice_series (doc_type) where is_active;

-- A prefix is part of numbers already issued.
create function public.protect_invoice_series() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.prefix is distinct from old.prefix and old.last_number > 0 then
    raise exception 'invoice_series_in_use';
  end if;
  if new.doc_type is distinct from old.doc_type and old.last_number > 0 then
    raise exception 'invoice_series_in_use';
  end if;
  return new;
end;
$$;
create trigger invoice_series_protected before update on public.invoice_series
  for each row execute function public.protect_invoice_series();

-- Provisional documents are only cleared by a deliberate server-side change
-- after the accountant confirms. A signed-in session can never do it.
create function public.protect_invoicing_settings() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.key = 'invoicing'
    and auth.uid() is not null
    and (new.value ->> 'isProvisional') is distinct from
      (case when tg_op = 'UPDATE' then old.value ->> 'isProvisional' else 'true' end)
  then
    raise exception 'provisional_flag_locked';
  end if;
  return new;
end;
$$;
create trigger invoicing_settings_protected before insert or update on public.settings
  for each row execute function public.protect_invoicing_settings();

-- Delivery fields may change after issue. The document itself may not.
create or replace function public.protect_issued_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'issued' then
      raise exception 'issued_invoice_immutable';
    end if;
    return old;
  end if;
  if old.status = 'issued' and (
    to_jsonb(new) - array['pdf_path', 'mydata', 'exported_at']
      is distinct from to_jsonb(old) - array['pdf_path', 'mydata', 'exported_at']
  ) then
    raise exception 'issued_invoice_immutable';
  end if;
  return new;
end;
$$;

create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function public.audit_change('customer');

-- Lines: [{description, quantity, unitCents, totalCents, vatCents,
-- vatBasisPoints, kind}]. totalCents includes vatCents. A fee line is outside
-- the VAT base and is reported separately.
create function public.write_invoice_lines(p_invoice_id uuid, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
  v_vat bigint;
  v_fee bigint;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'invoice_lines_required';
  end if;

  insert into public.invoice_lines (
    invoice_id, description, quantity, unit_cents, vat_basis_points,
    vat_cents, total_cents, kind, sort_order
  )
  select
    p_invoice_id, l.value ->> 'description',
    coalesce((l.value ->> 'quantity')::numeric, 1),
    (l.value ->> 'unitCents')::integer,
    coalesce((l.value ->> 'vatBasisPoints')::integer, 0),
    coalesce((l.value ->> 'vatCents')::integer, 0),
    (l.value ->> 'totalCents')::integer,
    coalesce(l.value ->> 'kind', 'accommodation'),
    l.ordinality::integer
  from jsonb_array_elements(p_lines) with ordinality l;

  select coalesce(sum(total_cents), 0), coalesce(sum(vat_cents), 0),
    coalesce(sum(total_cents) filter (where kind = 'fee'), 0)
  into v_total, v_vat, v_fee
  from public.invoice_lines where invoice_id = p_invoice_id;

  update public.invoices
  set total_cents = v_total, vat_cents = v_vat, fee_cents = v_fee,
      net_cents = v_total - v_vat - v_fee
  where id = p_invoice_id;
end;
$$;

create function public.finish_invoice(
  p_invoice_id uuid,
  p_doc_type public.invoice_doc_type,
  p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_series public.invoice_series;
  v_number integer;
  v_document_number text;
begin
  select * into v_series from public.invoice_series
  where doc_type = p_doc_type and is_active;
  if not found then
    raise exception 'invoice_series_missing';
  end if;

  -- Taken last, so anything that fails above leaves the sequence untouched.
  -- The row lock is held to commit, and a rollback restores the number.
  v_number := public.next_invoice_number(v_series.id);
  v_document_number := v_series.prefix || '-' || lpad(v_number::text, 6, '0');
  update public.invoices
  set series_id = v_series.id, number = v_number, document_number = v_document_number,
      status = 'issued', issued_at = now(), issued_by = p_actor
  where id = p_invoice_id;

  return jsonb_build_object(
    'invoice_id', p_invoice_id, 'number', v_number,
    'document_number', v_document_number,
    'already_issued', false
  );
end;
$$;

-- Safe to repeat for the same payment.
create function public.issue_invoice(
  p_booking_id uuid,
  p_doc_type public.invoice_doc_type,
  p_customer jsonb,
  p_lines jsonb,
  p_payment_id uuid default null,
  p_payment_method public.payment_method default null,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.booking_status;
  v_settings jsonb;
  v_existing public.invoices;
  v_id uuid;
begin
  perform public.set_actor(p_actor);
  if p_doc_type = 'credit_note' then
    raise exception 'use_issue_credit_note';
  end if;

  select status into v_status from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found';
  end if;
  if v_status in ('pending_payment', 'expired') then
    raise exception 'booking_not_confirmed';
  end if;

  if p_payment_id is not null then
    if not exists (
      select 1 from public.payments
      where id = p_payment_id and booking_id = p_booking_id and status = 'succeeded'
    ) then
      raise exception 'payment_not_found';
    end if;
    select * into v_existing from public.invoices
    where payment_id = p_payment_id and doc_type <> 'credit_note';
    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id, 'number', v_existing.number,
        'document_number', v_existing.document_number, 'already_issued', true
      );
    end if;
  end if;

  select value into v_settings from public.settings where key = 'invoicing';
  if v_settings is null or v_settings -> 'issuer' is null then
    raise exception 'invoice_settings_missing';
  end if;

  insert into public.invoices (
    booking_id, payment_id, doc_type, issuer, customer, payment_method, is_provisional
  ) values (
    p_booking_id, p_payment_id, p_doc_type, v_settings -> 'issuer', p_customer,
    p_payment_method, coalesce((v_settings ->> 'isProvisional')::boolean, true)
  ) returning id into v_id;

  perform public.write_invoice_lines(v_id, p_lines);
  return public.finish_invoice(v_id, p_doc_type, p_actor);
end;
$$;

-- INV-05. Lines are positive amounts; the document type makes them a credit.
-- Credits against one document can never exceed that document.
-- p_expected_credited_cents is what the form saw. If credits changed since, the
-- request is stale (a back button, a second tab), so it is refused.
create function public.issue_credit_note(
  p_invoice_id uuid,
  p_lines jsonb,
  p_reason text,
  p_expected_credited_cents integer,
  p_actor uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_original public.invoices;
  v_credited bigint;
  v_new_total bigint;
  v_id uuid;
begin
  perform public.set_actor(p_actor);
  if nullif(trim(p_reason), '') is null then
    raise exception 'credit_reason_required';
  end if;

  select * into v_original from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found';
  end if;
  if v_original.status <> 'issued' or v_original.doc_type = 'credit_note' then
    raise exception 'invoice_not_creditable';
  end if;

  select coalesce(sum(total_cents), 0) into v_credited from public.invoices
  where credits_invoice_id = p_invoice_id;
  if v_credited <> p_expected_credited_cents then
    raise exception 'credit_already_changed';
  end if;

  insert into public.invoices (
    booking_id, doc_type, credits_invoice_id, issuer, customer,
    payment_method, is_provisional, reason
  ) values (
    v_original.booking_id, 'credit_note', p_invoice_id, v_original.issuer,
    v_original.customer, v_original.payment_method, v_original.is_provisional, p_reason
  ) returning id into v_id;

  perform public.write_invoice_lines(v_id, p_lines);
  select total_cents into v_new_total from public.invoices where id = v_id;
  if v_new_total <= 0 or v_credited + v_new_total > v_original.total_cents then
    raise exception 'credit_exceeds_invoice';
  end if;

  return public.finish_invoice(v_id, 'credit_note', p_actor);
end;
$$;

create function public.attach_invoice_pdf(
  p_invoice_id uuid,
  p_path text,
  p_actor uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.set_actor(p_actor);
  update public.invoices set pdf_path = p_path where id = p_invoice_id;
end;
$$;

create function public.mark_invoices_exported(p_invoice_ids uuid[], p_actor uuid default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.set_actor(p_actor);
  update public.invoices set exported_at = now()
  where id = any (p_invoice_ids) and status = 'issued' and exported_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.write_invoice_lines(uuid, jsonb)',
    'public.finish_invoice(uuid, public.invoice_doc_type, uuid)',
    'public.issue_invoice(uuid, public.invoice_doc_type, jsonb, jsonb, uuid, public.payment_method, uuid)',
    'public.issue_credit_note(uuid, jsonb, text, integer, uuid)',
    'public.attach_invoice_pdf(uuid, text, uuid)',
    'public.mark_invoices_exported(uuid[], uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
