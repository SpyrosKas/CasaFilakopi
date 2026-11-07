# Data model

The schema lives in `supabase/migrations`; `lib/db/types.ts` is generated from it. This page explains how it fits together. D15 in `docs/PLAN.md` lists where it differs from the original spec.

Conventions: timestamps are UTC, stay dates are `date` with an exclusive check-out, business logic runs in Europe/Athens. Money is integer cents in EUR. Translatable text is `jsonb` keyed by locale, `{"en": "...", "el": "..."}`.

## Bookings and inventory

```mermaid
erDiagram
  guests ||--o{ bookings : makes
  rooms ||--o{ bookings : "is sold in"
  bookings ||--o| holds : "while paying"
  bookings ||--o| inventory_claims : "occupies dates"
  availability_blocks ||--o| inventory_claims : "occupies dates"
  external_events ||--o| inventory_claims : "occupies dates"
  rooms ||--o{ availability_blocks : "closes"
  rooms ||--o{ inventory_claims : "has"
  rooms ||--o{ external_calendars : "syncs through"
  external_calendars ||--o{ external_events : imports
  external_calendars ||--o{ sync_logs : records
  rooms ||--o| ical_export_tokens : "has export link"

  guests {
    uuid id PK
    text email "unique while not anonymised"
    text full_name
    text phone
    text country
    boolean marketing_consent
    timestamptz anonymized_at
  }
  bookings {
    uuid id PK
    text reference UK
    uuid room_id FK
    uuid guest_id FK
    booking_status status
    booking_source source
    date check_in
    date check_out
    text guest_name "contact as given on this booking"
    text guest_email
    jsonb price_breakdown
    int total_cents
    jsonb rules_snapshot "rules agreed at booking"
    text access_token_hash UK
  }
  holds {
    uuid id PK
    uuid booking_id FK
    timestamptz expires_at
    text stripe_checkout_session_id UK
  }
  inventory_claims {
    uuid id PK
    uuid room_id FK
    daterange stay "no overlaps, by constraint"
    claim_kind kind "hold, booking, block, external"
    uuid booking_id FK
    uuid block_id FK
    uuid external_event_id FK
    boolean is_conflicted
  }
  external_events {
    uuid id PK
    uuid calendar_id FK
    text uid
    date start_date
    date end_date
    text summary
    text guest_name "added by hand, D19"
    int amount_cents "Owner only"
    timestamptz anonymized_at
  }
```

**`inventory_claims` is the only table that holds the overbooking rule.** Its exclusion constraint makes an overlap impossible, even under concurrent requests. An imported event that collides is stored with `is_conflicted = true`, outside the constraint, so it is flagged and never lost.

`bookings.guest_*` is what was typed on that booking. A guest entering an existing email never changes the stored guest (unauthenticated callers cannot edit a guest).

## Money and documents

```mermaid
erDiagram
  bookings ||--o{ payments : receives
  bookings ||--o{ refunds : gives
  payments ||--o{ refunds : "refunded from"
  bookings ||--o{ invoices : "documented by"
  payments ||--o| invoices : "one document"
  invoices ||--o{ invoices : "credited by"
  invoice_series ||--o{ invoices : numbers
  invoices ||--|{ invoice_lines : contains

  payments {
    uuid id PK
    uuid booking_id FK
    payment_kind kind
    payment_method method
    payment_status status
    int amount_cents
    text stripe_payment_intent_id UK
  }
  refunds {
    uuid id PK
    uuid booking_id FK
    uuid payment_id FK
    int amount_cents
    refund_status status
    timestamptz settled_at
  }
  invoices {
    uuid id PK
    uuid booking_id FK
    uuid payment_id FK
    invoice_doc_type doc_type
    text document_number UK
    jsonb issuer
    jsonb customer "kept for tax, never anonymised"
    boolean is_provisional
    timestamptz exported_at
  }
```

Issued invoices and their lines are immutable: triggers refuse any change except `pdf_path`, `mydata` and `exported_at`. Numbers come from `next_invoice_number`, under a row lock.

`stripe_events` is keyed by Stripe's event id, so each event is handled once.

## Content and rates

```mermaid
erDiagram
  pages ||--o{ content_blocks : has
  media ||--o{ media_placements : "appears in"
  media ||--o{ places : illustrates
  rooms ||--o{ seasons : prices
  rooms ||--o{ rate_overrides : prices
  rooms ||--o{ restrictions : limits
  rooms ||--o{ room_amenities : has
  amenities ||--o{ room_amenities : "is in"

  content_blocks {
    uuid id PK
    uuid page_id FK
    text key
    jsonb draft "public roles cannot read this column"
    jsonb published
  }
  media_placements {
    uuid id PK
    text collection
    uuid media_id FK
    boolean is_cover
  }
```

`property` is a single row of legal details and the internal notification address. The public address and phone come from the CMS (D28). `settings` holds rules Yorgos edits, as `jsonb` by key: `payment`, `invoicing`, `retention` and others. `faq`, `testimonials` and `places` are published lists.

## Messages, email and operations

```mermaid
erDiagram
  bookings ||--o{ contact_messages : "related to"
  bookings ||--o{ email_logs : "emails about"
  contact_messages ||--o{ email_logs : "emails about"
  admin_profiles }o--|| auth_users : "is"

  email_logs {
    uuid id PK
    text template_key
    text recipient
    jsonb payload "never a raw token link"
    text status "queued to delivered"
    int attempts
    text resend_id UK
  }
  audit_log {
    bigint id PK
    uuid actor_id
    text action
    text entity
    text entity_id
    jsonb before "contact fields left out"
    jsonb after
  }
  job_runs {
    bigint id PK
    text job
    text status
    text detail
  }
  consent_log {
    bigint id PK
    text kind
    text subject "an id, never contact details"
    text policy_version
    boolean granted
  }
  admin_profiles {
    uuid id PK
    admin_role role "owner or staff"
    text display_name
  }
```

## Who can read what

Row Level Security is forced on every table, and access starts at nothing.

| Who | Reads | Writes |
| --- | --- | --- |
| Anonymous | Published content, `property`, public settings, `public_availability()` | Nothing directly |
| Staff | Operational data: bookings, guests, messages, calendars | Stay rules, message status |
| Owner, with two-step | Everything, including money, audit log, jobs | Configuration and content |
| Secret key, server only | Everything, skipping RLS and MFA | Through RPCs, after `current_admin_role()` |

`current_admin_role()` returns null for an Owner without an aal2 session, so MFA cannot be skipped by a client.

## Database functions

All are called by the server with the secret key.

| Area | Functions |
| --- | --- |
| Booking | `create_hold`, `attach_checkout_session`, `confirm_booking`, `confirm_without_payment`, `create_manual_booking`, `modify_booking`, `cancel_booking`, `transition_booking` |
| Money | `record_payment`, `reserve_refund`, `settle_refund`, `record_refund` |
| Calendar | `create_block`, `remove_block`, `upsert_external_event`, `remove_missing_external_events`, `update_external_event_details` |
| Documents | `issue_invoice`, `issue_credit_note`, `attach_invoice_pdf`, `mark_invoices_exported` |
| Settings | `save_rules`, `update_booking_notes` |
| Jobs | `run_database_job`, `release_expired_holds`, `complete_finished_bookings`, `purge_admin_attempts`, `apply_retention`, `call_cron_route` |
| Privacy | `anonymise_guest`, `anonymise_external_guest`, internal `scrub_personal_data`, `has_open_money` |
| Users | `add_admin`, `change_admin_role`, `remove_admin`, `delete_auth_sessions` |
| Guests | `booking_for_token`, `public_availability` |

Errors are raised by message, such as `dates_unavailable` or `guest_has_stay`, and the app turns them into plain words.

## Server actions and routes

Server actions are in `lib/admin/actions`, `lib/cms/actions`, `lib/channels/actions.ts`, `lib/email/admin-actions.ts` and `lib/invoicing/actions.ts`. Each starts with `requireAdmin()` or `requireOwner()`, validates with Zod, and calls an RPC through `callAdminRpc`, which checks the role in the database and passes the admin as `p_actor`.

| Route | Who | Purpose |
| --- | --- | --- |
| `POST /api/contact` | Public: origin check, Turnstile, Zod, rate limit | Contact form |
| `POST /api/consent` | Public: origin check, Zod, rate limit | Cookie choice log |
| `GET /api/ical/[file]` | Secret in the file name | Calendar for the channels |
| `POST /api/email/webhook` | Signed by Resend | Delivery events |
| `/api/cron/*` | Bearer `CRON_SECRET` | Jobs: `email`, `email/scheduled`, `channel-sync`, `cms`, `health` |
| `GET /api/health` | Public | Uptime check |
| `GET /admin/guests/[id]/export` | Owner | A guest's data as Excel |
| `GET /admin/bookings/export` | Owner | Bookings as Excel |
