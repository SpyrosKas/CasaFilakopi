# B&B Platform: Requirements Specification (What Needs to Be Built)

> Purpose: input document for planning development with a Claude Code agent harness.
> Scope: WHAT must be built. Sequencing, task breakdown and agent assignment are decided in the planning step.
> Every item has an ID (e.g. `BKG-04`) so plans, tasks and tests can reference it.
> Version 2. Changes from v1: real starting point (existing static site), target stack (Next.js + Supabase), media migration to Supabase Storage, invoicing module, dedicated availability management module.

---

## 0. Product Summary

### 0.1 Starting point (current state)

- The website exists today as a **static HTML/CSS site**.
- All images live as files in the project's `public/` folder.
- No database, no booking, no payments, no admin, no email.

### 0.2 Target state

A fully custom platform for a single B&B property (multiple rooms/units) that **keeps the current look and feel** and adds:

- Public website rebuilt in **Next.js**, visually identical (or near-identical) to the current site
- **Supabase** as the backend: Postgres database, Auth for admin users, Storage (S3-compatible) for all images and documents
- Direct **booking engine** with real availability, holds and overbooking protection
- **Stripe** payments (full, deposit, balance, refunds)
- **Invoicing** (receipts/invoices per Greek rules, optional myDATA transmission)
- **Admin panel / CMS** for the host: bookings, availability, rates, content, images, invoices, settings
- **Resend** for all transactional email, including contact messages from guests to the host
- **Optional** Booking.com / Airbnb calendar sync, enabled and configured **only from the Admin panel**, per client need

### 0.3 Target stack (fixed decisions)

| Layer | Choice |
|---|---|
| Frontend + server | Next.js (App Router, TypeScript) |
| Database | Supabase Postgres |
| Admin authentication | Supabase Auth |
| File storage | Supabase Storage (S3-compatible buckets) |
| Scheduled jobs | Supabase `pg_cron` + Edge Functions, or hosting platform cron (decided in planning) |
| Payments | Stripe |
| Email | Resend |
| Channel sync | iCal (optional module), adapter-ready for a channel manager API |

### 0.4 Roles

| Role | Description |
|---|---|
| Guest | Public visitor who browses, contacts the host, books and pays |
| Host (Owner) | Full admin access |
| Staff | Limited admin access (bookings, availability, guests, messages; no settings, payments config or invoicing config) |
| System | Background jobs (sync, emails, hold expiry, invoicing, cleanup) |

---

## 1. Migration from Static HTML/CSS to Next.js (MIG)

| ID | Requirement |
|---|---|
| MIG-01 | Audit the current static site: list all pages, sections, components, assets, fonts, scripts, forms and external embeds |
| MIG-02 | Extract the design system from the existing CSS: colours, typography, spacing, breakpoints, buttons, cards, form styles, as reusable tokens/variables |
| MIG-03 | Rebuild every existing page as Next.js components, **preserving the current look and feel** (layout, typography, colours, animations, responsive behaviour) |
| MIG-04 | Existing CSS reused (as global CSS / CSS Modules) or migrated to the chosen styling approach, with no visual regression |
| MIG-05 | Visual regression check: screenshots of old vs new site at mobile, tablet and desktop widths for every page, differences reviewed and approved |
| MIG-06 | Preserve existing URLs; where a URL must change, add permanent (301) redirects so SEO and existing links are not lost |
| MIG-07 | Existing hardcoded text moved into the database (CMS content) so it becomes editable from Admin (see ADM content section) |
| MIG-08 | New pages/flows (booking, checkout, confirmation, guest booking page) designed in the **same visual style** as the existing site |
| MIG-09 | Static site stays live until the Next.js site is approved; cutover plan with DNS/hosting switch and rollback option |

---

## 2. Supabase Platform: Database, Auth, Storage (SUP)

### 2.1 Database

| ID | Requirement |
|---|---|
| SUP-01 | Supabase projects per environment: local (Supabase CLI), staging, production |
| SUP-02 | Full schema managed through **versioned SQL migrations** in the repository (Supabase CLI), never manual changes in the dashboard |
| SUP-03 | Entities (minimum): property, rooms, room_photos, amenities, rates/seasons, restrictions, taxes_fees, promo_codes, cancellation_policies, bookings, booking_nights or date ranges, holds, guests, payments, refunds, invoices, invoice_lines, invoice_series, availability_blocks, external_calendars, external_events, sync_logs, contact_messages, email_templates, email_logs, pages/content blocks (per language), faq, settings, admin_profiles/roles, audit_log, consent_log |
| SUP-04 | Overbooking protection in Postgres: `btree_gist` **exclusion constraint** on (room, date range) for confirmed bookings, active holds and blocks, so overlaps are impossible even under concurrent requests |
| SUP-05 | Critical operations (create hold, confirm booking, cancel, refund) executed as **atomic database transactions / Postgres functions (RPC)** |
| SUP-06 | **Row Level Security (RLS)** enabled on every table: public can read only published content and availability; guests access their own booking only via secure token; admin access by role |
| SUP-07 | Service role key used **only server-side** (Next.js server code, Edge Functions); never shipped to the browser |
| SUP-08 | Generated TypeScript types from the database schema, used across the app |
| SUP-09 | Seed scripts for local/staging (sample rooms, rates, bookings, content) |
| SUP-10 | Backups: daily backups on production plan, point-in-time recovery decision documented, tested restore procedure |
| SUP-11 | Timestamps in UTC, all business date logic in the property timezone (Europe/Athens); stay dates stored as dates (no time) |

### 2.2 Authentication (admin)

| ID | Requirement |
|---|---|
| SUP-12 | Supabase Auth for Host and Staff (email + password), password reset by email, invite-only (no public sign-up) |
| SUP-13 | Multi-factor authentication (TOTP) mandatory for Owner, optional for Staff |
| SUP-14 | Role stored in an admin profile table and enforced in RLS policies and in Next.js middleware/server checks |
| SUP-15 | Guests do **not** need accounts; they access their booking through a signed, expiring token link |

### 2.3 Storage (images and documents)

| ID | Requirement |
|---|---|
| SUP-16 | Buckets: `media` (public: site and room images), `invoices` (private: invoice/receipt PDFs), `uploads-private` (private: anything else sensitive) |
| SUP-17 | **Migrate all images from the project's `public/` folder to the `media` bucket**, with a one-off migration script that uploads files, creates media records in the DB, and rewrites all references |
| SUP-18 | After migration, `public/` keeps only static assets that are part of the code (favicon, logo, fonts, icons); all content images come from Supabase Storage |
| SUP-19 | Images served optimised: Next.js `<Image>` with a Supabase loader or Supabase image transformations (resize, WebP/AVIF), lazy loading, responsive sizes |
| SUP-20 | Upload from Admin: file type and size validation, automatic resize/compression, alt text per language, ordering, cover image, safe delete (warn if used) |
| SUP-21 | Storage policies: only Admin can write to `media`; private buckets readable only via short-lived signed URLs generated server-side |

---

## 3. Public Website (WEB)

| ID | Requirement |
|---|---|
| WEB-01 | Next.js site with the existing design (see MIG), mobile-first, fast (target Lighthouse 90+ on performance, accessibility, SEO) |
| WEB-02 | Pages: Home, Rooms list, Room detail, Gallery, Location / How to get here, About, Contact, FAQ, House rules (plus any extra pages already on the current site) |
| WEB-03 | Legal pages: Privacy Policy, Terms and Conditions, Cancellation Policy, Cookie Policy (editable from Admin) |
| WEB-04 | Room detail page: photos, description, amenities, capacity, bed setup, price "from", live availability calendar, Book button |
| WEB-05 | Availability search widget (check-in, check-out, guests) on Home and Rooms pages, showing available rooms and total price |
| WEB-06 | Multilingual (minimum Greek and English; architecture allows more): locale routing (e.g. `/el`, `/en`), language switcher, translated content from DB |
| WEB-07 | All content (texts, images, rooms, FAQ, prices) rendered from Supabase, no hardcoded content |
| WEB-08 | Rendering: static generation / ISR for content pages, revalidated on publish from Admin; dynamic data (availability, prices) fetched live |
| WEB-09 | SEO: per-page meta, Open Graph, sitemap.xml, robots.txt, canonical and hreflang, schema.org `LodgingBusiness` / `HotelRoom` |
| WEB-10 | Embedded map (location page), loaded only after cookie consent if it sets cookies |
| WEB-11 | Contact form (see CNT section) |
| WEB-12 | Cookie consent banner (GDPR), blocks non-essential scripts until consent |
| WEB-13 | Optional analytics, loaded only after consent |
| WEB-14 | Accessibility: WCAG 2.1 AA target (semantic HTML, alt texts, keyboard navigation, contrast) |
| WEB-15 | Footer shows legal registration number (Greek short-term rental registry / MHTE), editable in settings |
| WEB-16 | Custom 404 and error pages in the site's style |

---

## 4. Availability Management (AVL)

> Single source of truth for whether a room can be sold on a given night. Used by the website, the booking engine, the Admin and (if enabled) the channel sync.

| ID | Requirement |
|---|---|
| AVL-01 | Availability per room per night calculated from: confirmed bookings, active checkout holds, manual blocks by host, closed periods, imported external events (only if CHN enabled) |
| AVL-02 | Host can **open/close a whole room** (active/inactive) and **close the whole property** for a date range (e.g. winter season) |
| AVL-03 | Host can **block / unblock dates per room** with a reason (maintenance, owner use, other), single or bulk (date range, multiple rooms at once) |
| AVL-04 | Host can set availability rules per date range: minimum/maximum stay, closed-to-arrival, closed-to-departure, check-in days allowed |
| AVL-05 | Global rules: booking lead time (e.g. no same-day booking after a set hour), maximum booking horizon (e.g. 18 months), season opening/closing dates |
| AVL-06 | Admin **calendar view**: multi-room timeline (rows = rooms, columns = days) showing bookings (by source), holds, manual blocks, external events (colour-coded), with click-to-block and click-to-open-booking |
| AVL-07 | Admin **rates calendar**: view and edit nightly price and restrictions per room per day, with bulk edit by date range and weekday |
| AVL-08 | Any availability change takes effect immediately on the public site and in the iCal export feed (if CHN enabled) |
| AVL-09 | Public availability API/endpoint returns only what is needed (available or not, price), never guest or booking details |
| AVL-10 | All availability changes recorded in the audit log |

---

## 5. Booking Engine (BKG)

### 5.1 Pricing

| ID | Requirement |
|---|---|
| BKG-01 | Room attributes: capacity (adults/children), base occupancy, base price, inventory = 1 (unit-based), active flag |
| BKG-02 | Pricing: base nightly price, seasonal prices (date ranges), weekday/weekend prices, per-day overrides (from AVL-07), extra guest fee, optional cleaning fee |
| BKG-03 | Taxes and fees configurable, including the Greek per-night accommodation fee (climate resilience fee) as a separate configurable line item, and VAT rate(s) configurable (not hardcoded) |
| BKG-04 | Promo codes: percentage or fixed, validity dates, usage limit, room restrictions |
| BKG-05 | Price breakdown shown before payment: nights × rate, fees, taxes, discount, total, amount due now, balance due later |
| BKG-06 | Price is **recalculated server-side** at checkout; the client never decides the price |

### 5.2 Booking flow

| ID | Requirement |
|---|---|
| BKG-07 | Guest flow: search dates → choose room → guest details → invoice details (optional, see INV) → review and accept terms → pay with Stripe → confirmation page and email |
| BKG-08 | Guest details: name, email, phone, country, number of adults/children, estimated arrival time, special requests, marketing consent (separate opt-in) |
| BKG-09 | **Temporary hold**: starting checkout creates a hold on the room/dates for N minutes (configurable, e.g. 15); expired holds released automatically by a scheduled job |
| BKG-10 | Hold and booking creation protected by the DB exclusion constraint (SUP-04); a conflicting request fails cleanly with a user-friendly message |
| BKG-11 | Booking status lifecycle: `pending_payment` → `confirmed` → `checked_in` → `completed`, plus `cancelled`, `expired`, `refunded`, `no_show` |
| BKG-12 | Booking confirmed **only** after a verified Stripe webhook, never from the browser redirect alone |
| BKG-13 | Human-readable booking reference (e.g. `BNB-2026-00042`) |
| BKG-14 | Booking source recorded: direct website, manual (Admin), Booking.com, Airbnb, other |
| BKG-15 | Guest self-service page via secure token link: view booking, pay balance, download receipt/invoice, request cancellation per policy, contact host |
| BKG-16 | Cancellation policy engine: configurable rules (free until X days before, then Y% charged, non-refundable rate option); refund amount calculated automatically |
| BKG-17 | Manual bookings by host in Admin (phone, walk-in, repeat guests), with or without online payment (cash/bank transfer recorded manually) |
| BKG-18 | Modify booking from Admin: change dates or room (availability check + price difference handled as extra charge or refund) |

---

## 6. Payments: Stripe (PAY)

| ID | Requirement |
|---|---|
| PAY-01 | Stripe Checkout Sessions or Payment Intents, SCA / 3D Secure compliant, EUR; Apple Pay / Google Pay enabled where available |
| PAY-02 | Payment modes configurable in Admin: full payment at booking, deposit (percentage or fixed) with balance later, or pay balance on arrival |
| PAY-03 | Balance collection: automatic payment link email X days before arrival (configurable), manual "send payment link" in Admin, and pay-balance button on guest booking page |
| PAY-04 | Next.js webhook route handler with Stripe signature verification (raw body) and **idempotent** processing (each event stored and handled once) |
| PAY-05 | Handle events: payment succeeded, payment failed, checkout expired, refund created/updated, dispute opened/closed |
| PAY-06 | Full and partial refunds triggered from Admin, with reason; refund triggers credit note (INV) and email |
| PAY-07 | Manual payments recorded in Admin (cash, bank transfer, POS) so balance and invoicing stay correct |
| PAY-08 | Payment records stored in Supabase (amount, method, status, Stripe IDs); no card data stored |
| PAY-09 | Stripe test/live keys per environment via environment variables; secrets never in DB or browser |
| PAY-10 | Failed or abandoned payment: hold released, booking marked `expired`, guest optionally notified |
| PAY-11 | Admin view of payment status per booking: paid, deposit paid, balance due, refunded, disputed |

---

## 7. Invoicing (INV)

> Greek invoicing rules for accommodation must be confirmed with the client's accountant before implementation (document types, VAT, fee treatment, myDATA method). Everything below is configurable for that reason.

| ID | Requirement |
|---|---|
| INV-01 | Issue a **receipt** (retail, for individuals) or **invoice** (for companies, with VAT number, company name, address, tax office) per booking; guest chooses at checkout, host can change in Admin before issuing |
| INV-02 | Invoice/receipt contains: issuer business details, sequential number per series, issue date, guest/company details, line items (accommodation nights, extras, cleaning fee), VAT breakdown, climate resilience fee as separate non-VAT line, totals, payment method, booking reference |
| INV-03 | **Numbering series** per document type, sequential without gaps, generated atomically in the DB |
| INV-04 | Issuing trigger configurable: automatically on payment (deposit and/or balance), at check-out, or manually by host |
| INV-05 | **Credit notes** for refunds/cancellations, linked to the original document |
| INV-06 | PDF generation in the site's branding, stored in the private `invoices` bucket, downloadable by host in Admin and by guest via booking page (signed URL), attached to email |
| INV-07 | Issued documents are **immutable**; corrections only via credit note and new document |
| INV-08 | **myDATA (AADE) transmission**, configurable in Admin: Off (manual, handled by accountant) / via certified e-invoicing provider API / direct myDATA REST API. Built behind an adapter interface |
| INV-09 | When myDATA is enabled: store MARK, UID, QR code / link on the document; retry and error queue; failures visible to host |
| INV-10 | Invoicing for bookings that came from Booking.com / Airbnb (if CHN enabled): host can create the invoice/receipt manually from the booking in Admin |
| INV-11 | Invoices list in Admin with filters (date, type, status, transmitted or not) and **export** (CSV/Excel + ZIP of PDFs) for the accountant, per month |
| INV-12 | Invoice settings in Admin: business legal details, VAT number, tax office, series, VAT rates, fee rules, default document type, myDATA mode and credentials (credentials stored as secrets, not in plain DB columns) |

---

## 8. Contact and Guest Communication (CNT)

| ID | Requirement |
|---|---|
| CNT-01 | Contact form on the site: name, email, phone (optional), dates of interest (optional), message, GDPR consent checkbox |
| CNT-02 | On submit: message **saved in Supabase** and **emailed to the host** via Resend, with the guest's email as Reply-To so the host can answer directly from their mailbox |
| CNT-03 | Auto-reply email to the guest confirming the message was received (in their language) |
| CNT-04 | Spam protection: honeypot field, CAPTCHA (e.g. Cloudflare Turnstile), rate limiting per IP |
| CNT-05 | Admin inbox: list of messages, read/unread, status (new, replied, archived), link to related booking/guest if email matches |
| CNT-06 | Guest can send a message to the host from the guest booking page; delivered to host email and stored on the booking |
| CNT-07 | Host notification recipients configurable (one or more email addresses) |

---

## 9. Channel Integration: Booking.com / Airbnb (CHN), OPTIONAL

> This whole module is **optional**. It is **disabled by default** and is enabled, configured and disabled **only from the Admin panel**, depending on whether the client uses these channels. When disabled, no sync jobs run and nothing related appears on the public site.

### 9.1 Toggle and configuration (Admin only)

| ID | Requirement |
|---|---|
| CHN-01 | Admin → Settings → Integrations: global "Channel sync" on/off |
| CHN-02 | Per-channel toggle: Booking.com, Airbnb, "Other iCal" (e.g. Vrbo) |
| CHN-03 | Per-room mapping: for each room and enabled channel, a field for the channel's **import iCal URL** |
| CHN-04 | Configurable sync interval (e.g. 10, 15, 30, 60 minutes) |
| CHN-05 | Validation when saving a URL (reachable, valid iCal) with clear error message |

### 9.2 Import (channel → our system)

| ID | Requirement |
|---|---|
| CHN-06 | Scheduled job fetches each feed and stores events as external events blocking the room (feeds AVL-01) |
| CHN-07 | Upsert by event UID: new added, changed dates updated, removed events released |
| CHN-08 | Imported events shown as bookings with source Booking.com / Airbnb in Admin, where host can add guest details and notes manually |
| CHN-09 | "Sync now" button per room and globally |

### 9.3 Export (our system → channels)

| ID | Requirement |
|---|---|
| CHN-10 | Per-room **export iCal URL** (secret token) with direct bookings, manual bookings, holds (optional) and manual blocks, to paste into Booking.com / Airbnb |
| CHN-11 | Export never re-exports events imported from the same channel (no loops) |
| CHN-12 | Admin can regenerate the export token (old URL stops working) |

### 9.4 Conflicts and monitoring

| ID | Requirement |
|---|---|
| CHN-13 | Conflict detection: imported event overlapping a confirmed booking is flagged, host alerted by email, shown on Admin dashboard |
| CHN-14 | Sync log per feed: last run, status, events count, errors |
| CHN-15 | Alert after repeated failures (e.g. 3 in a row) or no successful sync beyond a threshold |
| CHN-16 | Admin UI states the limitation: iCal sync is near-real-time, not instant, so a small overbooking risk remains within the sync interval |
| CHN-17 | Built behind a provider interface (adapter) so a real-time channel manager API (e.g. Beds24) can be added later without changing booking or availability logic |

---

## 10. Admin Panel / CMS (ADM)

> Built inside the same Next.js app under `/admin`, protected by Supabase Auth, styled consistently but separate from the public design.

### 10.1 Access and security

| ID | Requirement |
|---|---|
| ADM-01 | Login, logout, password reset, session timeout (Supabase Auth, SUP-12 to SUP-14) |
| ADM-02 | Roles: Owner (everything), Staff (bookings, availability, guests, messages) |
| ADM-03 | Login rate limiting / lockout |
| ADM-04 | Audit log of admin actions (who, what, when, before/after) viewable by Owner |

### 10.2 Dashboard

| ID | Requirement |
|---|---|
| ADM-05 | Today's arrivals/departures, upcoming bookings, balances due, unread messages, occupancy this month, invoices pending or failed transmission, sync conflicts/alerts (if CHN enabled) |

### 10.3 Bookings

| ID | Requirement |
|---|---|
| ADM-06 | Bookings list with filters (dates, status, room, source, payment status) and search (name, email, reference) |
| ADM-07 | Booking detail: guest, stay, price breakdown, payments, refunds, invoices, emails sent, messages, internal notes, history |
| ADM-08 | Actions: create manual booking, modify dates/room, cancel, refund, record manual payment, send balance link, resend confirmation, issue invoice/credit note, mark checked-in / checked-out / no-show |
| ADM-09 | Export bookings to CSV |

### 10.4 Availability and rates

| ID | Requirement |
|---|---|
| ADM-10 | Availability calendar and blocking (AVL-02, AVL-03, AVL-06) |
| ADM-11 | Rates calendar and seasons (AVL-07, BKG-02) |
| ADM-12 | Restrictions and global booking rules (AVL-04, AVL-05) |
| ADM-13 | Taxes and fees, promo codes, cancellation policies |

### 10.5 Rooms and content (CMS)

| ID | Requirement |
|---|---|
| ADM-14 | Rooms: create/edit/deactivate; name, descriptions (per language), capacity, beds, amenities, photos (ordering, cover) |
| ADM-15 | Page content editing for all public pages (rich text, per language), structured to match the existing page sections |
| ADM-16 | Media library on Supabase Storage (SUP-20): upload, replace, alt text, ordering, usage check before delete |
| ADM-17 | FAQ, house rules and legal pages management (per language) |
| ADM-18 | SEO fields per page (meta title, description, OG image) |
| ADM-19 | Draft / publish workflow with preview; publish triggers Next.js revalidation of affected pages |

### 10.6 Guests, messages, invoices, reports

| ID | Requirement |
|---|---|
| ADM-20 | Guest list built from bookings, history per guest, GDPR export/anonymise (CMP-02) |
| ADM-21 | Messages inbox (CNT-05) |
| ADM-22 | Invoices section (INV-11) |
| ADM-23 | Reports: occupancy, revenue per month, revenue by room and by source, ADR, average length of stay, cancellations |

### 10.7 Settings

| ID | Requirement |
|---|---|
| ADM-24 | Business info: name, legal details, address, phone, email, registration number, check-in/check-out times, social links |
| ADM-25 | Booking settings: hold duration, payment mode, deposit rules, balance reminder timing |
| ADM-26 | Invoicing settings (INV-12) |
| ADM-27 | Email settings: sender name, reply-to, host recipients, editable templates (EML-06) |
| ADM-28 | Integrations: Channel sync (CHN-01 to CHN-05), analytics ID |
| ADM-29 | Languages enabled on the site |
| ADM-30 | User management (Owner only): invite/remove staff, assign roles |

---

## 11. Email: Resend (EML)

| ID | Requirement |
|---|---|
| EML-01 | Resend with verified sending domain (SPF, DKIM, DMARC) |
| EML-02 | Guest emails: booking confirmation, payment receipt, invoice/receipt (PDF attached), balance payment request, balance reminder, pre-arrival info (directions, check-in), cancellation confirmation, refund confirmation, contact auto-reply, post-stay thank you (optional) |
| EML-03 | Host emails: new booking, modification, cancellation, payment failed, dispute opened, new contact message, new guest message, sync conflict, sync failure, invoice transmission failure |
| EML-04 | Templates built in React Email (or equivalent), responsive HTML + plain text, branded like the site, in the guest's language |
| EML-05 | Placeholders: guest name, dates, room, reference, amounts, booking page link, etc. |
| EML-06 | Template texts editable from Admin per language |
| EML-07 | Sending through a queue with retries; failures logged and visible in Admin |
| EML-08 | Email log per booking and per message (type, recipient, time, status via Resend webhooks) |
| EML-09 | Calendar attachment (.ics) on confirmation email (optional) |

---

## 12. Background Jobs and Scheduling (JOB)

| ID | Requirement |
|---|---|
| JOB-01 | Expire checkout holds (every minute) |
| JOB-02 | iCal import per feed (per configured interval, only if CHN enabled) |
| JOB-03 | Balance payment requests and reminders |
| JOB-04 | Pre-arrival and post-stay emails |
| JOB-05 | Email queue processing and retries |
| JOB-06 | Invoice issuing (if automatic) and myDATA transmission retries |
| JOB-07 | Booking status transitions (e.g. to `completed` after check-out date) |
| JOB-08 | GDPR retention: anonymise guest data older than configured period (excluding data legally required for invoicing) |
| JOB-09 | Every job logs runs and failures; repeated failures alert the host/admin |

---

## 13. Platform, Hosting and DevOps (PLT)

| ID | Requirement |
|---|---|
| PLT-01 | Next.js hosting (e.g. Vercel or equivalent) with preview deployments per branch |
| PLT-02 | Environments: local, staging, production, each with its own Supabase project, Stripe mode and Resend config |
| PLT-03 | Secrets via environment variables / platform secret manager; `.env.example` documented |
| PLT-04 | CI/CD: lint, type check, tests, build, apply Supabase migrations to staging, manual promotion to production |
| PLT-05 | Security: HTTPS, security headers (CSP, HSTS), input validation (e.g. Zod) on all server actions/routes, rate limiting on public endpoints, CSRF-safe server actions |
| PLT-06 | Error tracking (e.g. Sentry) and uptime monitoring with alerts |
| PLT-07 | Structured logs for API routes, webhooks and jobs |
| PLT-08 | Domain and DNS setup, including email DNS records for Resend |

---

## 14. Compliance and Legal (CMP)

| ID | Requirement |
|---|---|
| CMP-01 | GDPR: privacy policy, separate marketing opt-in, data retention policy |
| CMP-02 | Data subject requests from Admin: export and anonymise guest data (invoice data retained as legally required) |
| CMP-03 | Terms and cancellation policy acceptance stored with timestamp and policy version on each booking |
| CMP-04 | Cookie consent logged |
| CMP-05 | Greek registration number shown on the site (WEB-15) |
| CMP-06 | Invoicing compliance validated with the client's accountant (INV section) |

---

## 15. Testing and Quality (QA)

| ID | Requirement |
|---|---|
| QA-01 | Unit tests: pricing, taxes/fees, restrictions, availability, cancellation and refund calculation, invoice totals and numbering |
| QA-02 | Database tests: exclusion constraint and RPC functions prove no double booking under concurrent requests |
| QA-03 | RLS tests: anonymous, guest token, staff and owner can access only what they should |
| QA-04 | Integration tests: Stripe webhooks (Stripe CLI), Resend (test mode), iCal import/export with fixture feeds, myDATA adapter against sandbox/mock |
| QA-05 | End-to-end tests (e.g. Playwright): guest booking with payment, contact form, admin manual booking, block dates, cancellation with refund and credit note, sync conflict |
| QA-06 | Visual regression tests for migrated pages (MIG-05) |
| QA-07 | Accessibility and performance checks in CI |

---

## 16. Documentation and Handover (DOC)

| ID | Requirement |
|---|---|
| DOC-01 | README: architecture, local setup (Next.js + Supabase CLI), environment variables, deployment, migrations |
| DOC-02 | Host user guide (Greek and English): bookings, availability and rates, content and images, invoices, messages, settings, how to connect Booking.com / Airbnb via iCal |
| DOC-03 | Runbook: backups and restore, secret rotation, Stripe disputes, sync conflicts, failed invoice transmission |
| DOC-04 | Data model documentation (ER diagram) and API/server action reference |

---

## 17. Open Decisions (resolve before or during planning)

1. Styling approach for the migration: reuse existing CSS as-is vs move to Tailwind/CSS Modules (must keep the same look either way).
2. Scheduler: Supabase `pg_cron` + Edge Functions vs hosting platform cron.
3. Hosting provider for Next.js.
4. Languages at launch.
5. Default payment mode (full vs deposit) and cancellation rules.
6. Invoicing: document types, VAT treatment, and myDATA mode (off / provider / direct), confirmed with the accountant.
7. Whether channel sync is enabled at launch for this client (module is built either way, off by default).
8. Whether a real-time channel manager (CHN-17) is expected later.

## 18. Out of Scope (unless added later)

- Multi-property / multi-tenant support
- Native mobile apps
- Real-time API integration with Booking.com / Airbnb (iCal only; adapter ready)
- Pushing rates and inventory to OTAs (prices are managed on each channel separately)
- Guest reviews system
- Accounting / ERP integration beyond invoice export
