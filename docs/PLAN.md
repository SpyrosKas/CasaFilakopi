# Casa Filakopi: Build Plan

Spec: [requirements.md](requirements.md) (v2). IDs like `BKG-09` refer to it.
Working branch: `dev-booking`. `master` stays the live static site until cutover.

**Status:** Every track built, reviewed, merged. CI fully green on `integration` (7def1e9). Staging database at migration 18. Local `dev-booking` is held back from origin until YOU run the staging imports, because the code then expects photos and text in Supabase. Order: imports, push, Google Workspace, Resend, Stripe test mode, Vault secrets, real Airbnb and Booking.com feeds.
**Tick rule:** a task is ticked only after it is done and verified (tests pass or result seen). Blocked items get `[!]` plus a note. Every decision goes in the Decisions log.

Legend: `[ ]` to do, `[x]` done, `[!]` blocked. Owner tags: **YOU** (Spyros), **HOST** (Yorgos), **ACC** (accountant), **LEAD** (main Claude session), **WEB / ENGINE / ADMIN / MAIL / PAY / CMS / CHN / INV / QA** (worker agents).

---

## 1. Where the spec and the repo disagree

| # | Spec says | Repo shows | Consequence |
|---|---|---|---|
| F1 | Multiple rooms/units | One farmhouse with one listing on each OTA. Two bedrooms "can be isolated", but they are sold as a house | See D1. If whole-house only, drop Rooms list/detail and the room-choice step; keep a `rooms` table with one row so the schema stays general |
| F2 | Booking.com/Airbnb sync optional, off by default | Live Airbnb, Booking.com and HomeAway listings | With one unit, direct booking without sync means real double bookings. See D2 |
| F3 | Pages: Home, Rooms, Gallery, About, Contact, FAQ, House rules | Only 3 pages: `index`, `host`, `directions` | New pages need content that does not exist yet (FAQ, house rules, legal) |
| F4 | Greek + English | English only, no Greek text anywhere | All Greek copy must be written, then reviewed by HOST |
| F5 | Images in `public/` | Images in `img/` (68 files, 6.3 MB). No `public/` folder | SUP-17 script targets `img/` |
| F6 | Greek registry number "MHTE" | No number on the site | Short-term rentals normally use an AMA number rather than MHTE. See D4 |
| F7 | Receipts and invoices assumed | Legal setup of the host unknown | If this is a private individual's short-term rental, the whole INV module may shrink a lot. See D4. Do not build INV until ACC answers |
| F8 | Not mentioned | Testimonials, "Places to visit" and amenities sections exist | Add `testimonials` and `places` as CMS content (no conflict with "no review system": these stay curated text) |
| F9 | Not mentioned | Site said "Casa Milos", OTAs and socials say "Casa Filakopi"; `miloscasa.com` in the code | Settled by D5: the name is Casa Filakopi |
| F11 | `MIG-03` says keep the current look | Mobile is broken: below 992 px the round `.img-absolute` photo (`bottom: -100px`, `css/style.css:458`) covers the heading or text in all 7 house sections. Something also forces the page wider than the screen (475 px layout on a 375 px phone) | Mobile is a deliberate exception to "identical". Fix it, do not preserve it. See T3.1a to T3.1c |
| F10 | Not mentioned | Stale items: HomeAway link (now Vrbo), Vimeo link, tracked `.DS_Store`, backslash icon path | Clean up during migration |

### Spec corrections (technical)

- **SUP-04 cannot work as written.** A Postgres exclusion constraint covers one table only, so it cannot span bookings, holds and blocks. Design: a single `inventory_claims` table (`room_id`, `stay daterange`, `kind`, `source_id`) holds the constraint, and each booking, hold or block owns one claim row.
- **BKG-09 example of 15 minutes conflicts with Stripe.** A Checkout Session must live at least 30 minutes. A 15-minute hold would let a guest pay after the hold died. Design: hold 35 minutes, session 30 minutes.
- **Paid after hold lost:** if a late webhook finds the dates gone, auto-refund and alert the host. Spec does not cover this. Added as T6.8.
- **External events cannot use the hard constraint.** CHN-13 needs an imported overlap to be stored and flagged, not rejected. External claims that collide are saved with `conflict = true` and excluded from the constraint through a partial `WHERE`. Direct bookings are still refused against all external claims, checked inside the RPC.
- **Holds expiring (JOB-01):** a constraint cannot use `now()`, so the hold RPC also clears expired overlapping holds in the same transaction. The minute job is cleanup, not the safety net.
- **Node:** machine has 20.16, which is end-of-life. Move to current LTS.

---

## 2. Decisions log

| ID | Decision | Status | Answer |
|---|---|---|---|
| D1 | Sell whole house only, or also single bedrooms? | **Decided** | Whole house only. One row in `rooms`; no Rooms list/detail pages or room-choice step (`WEB-02`, `WEB-04`, `BKG-07` adjusted) |
| D2 | Channel sync on at launch? | **Decided** | On at launch for Airbnb + Booking.com; CHN moves from optional to launch-blocking. HomeAway/Vrbo depends on A9. The Admin toggle stays |
| D3 | Who owns accounts and takes payments? | **Decided** | Yorgos is legal owner and activates Stripe (A10). `host@miloscasa.com` owns the technical accounts |
| D4 | Host legal/tax setup (business vs individual short-term rental; AMA vs MHTE; VAT; myDATA) | **With ACC** | Sheet ready: [accountant-questions.md](accountant-questions.md). INV waits; everything else continues |
| D5 | Public brand name and domain; where the site is hosted today | **Decided** | The house is **Casa Filakopi**. `miloscasa.com` is only the web address (Namecheap, expires 2027-04-11, auto-renew on, Netlify today). Accounts and guest mail use `host@miloscasa.com` through Namecheap forwarding |
| D6 | Payment mode and cancellation rules | **Decided** | Yorgos edits these any time in Admin. Two modes: **Full payment (default)** or **Deposit**, where he sets the percentage and days before arrival the rest is due; 0 days means pay on arrival. Booking on or after the due date pays in full. Refund tiers are a percentage of the booking: charge = total minus refund percent, refund = paid minus charge, floored at 0, and any shortfall shows as still owed. Changes apply to new bookings only; each booking keeps a snapshot |
| D7 | Languages at launch | Proposed | Greek + English |
| D8 | Styling (spec open decision 1) | Proposed | Keep existing `bootstrap.css` and `style.css` as global CSS; replace jQuery, Bootstrap JS and AOS behaviour with small React components |
| D9 | Scheduler (open decision 2) | **Decided** | `pg_cron` calling SQL or secured Next.js routes. Vercel Hobby cron is too limited |
| D10 | Hosting (open decision 3) | **Decided** | Vercel (Pro at launch). Database on managed Supabase: Pro for production (Free has no backups and pauses), Free for staging |
| D11 | Stripe surface (PAY-01) | Proposed | Hosted Checkout Sessions |
| D12 | Repo layout | Proposed | Next.js at repo root; static site moved to `legacy/` on `dev-booking` as the visual baseline, deleted after cutover |
| D13 | Real-time channel manager later (open decision 8) | Proposed | Not now; adapter only |
| D15 | Schema changes from the spec | Decided | `booking_nights` dropped (stay range plus `price_breakdown`). `room_photos` became `media_placements`, per section. `email_queue` merged into `email_logs`. `rate_overrides` is the spec's `rates` |
| D16 | Paid hold on dates an import has already sold | Decided | Automatic refund plus host alert (`dates_lost`). Nothing-due-now bookings confirm through `confirm_without_payment` |
| D17 | Build invoicing before the accountant answers | Decided | Yes. Dummy business details, every document marked provisional and not sent to guests until D4 is confirmed. PDFs in the private `invoices` bucket. Admin filters by month, transaction, booking. myDATA mode Off: Yorgos exports to the accountant, who uploads. VAT and document types stay data |
| D18 | Modernise the design | **Decided** | Owner approved the redesign and language flags. Overrides "keep the look" (MIG-03). Resolves button contrast. Use design tokens, not Bootstrap classes |
| D19 | Airbnb and Booking.com bookings | Decided | Shown in Admin with their source. iCal gives dates, so Yorgos adds guest contacts and the amount by hand, and they then count in reports. A channel manager such as Beds24 stays an option for later |
| D20 | Accountant timing | Decided | Accountant answers once everything is finished. Documents stay provisional until then, and that step remains a launch blocker for real invoices |
| D21 | Export format | Decided | Real Excel file (.xlsx) replaces CSV, after the owner tested Excel on a Mac |
| D22 | Guest mailbox | Decided | `host@miloscasa.com` becomes a real Google Workspace mailbox, replacing Namecheap forwarding, so Yorgos replies from that address. DNS stays in Namecheap. Resend sends from `mail.miloscasa.com` |
| D23 | Working alone | Decided 2026-11-07 | LEAD may merge reviewed work, push to `dev-booking` and apply migrations to staging during the 6-hour block. `master`, live site and DNS stay untouched |
| D24 | Late cancellation on a deposit | Decided | Yorgos keeps the deposit and the shortfall is not chased. `stillOwedCents` is not shown to guests or collected |
| D25 | Admin language | Decided | Greek by default with an EN/EL switch. Greek text reviewed by HOST |
| D26 | FAQ, house rules, legal drafts | Decided | LEAD drafts them in Greek and English as unpublished drafts, using only known facts. Legal text needs professional review before publishing |
| D14 | Launch target | Proposed | Live before the 2027 season bookings start (aim for March 2027) |

---

### Decided during the autonomous block (D28, 2026-11-07)

| Topic | Decision |
|---|---|
| Partial refund on a live or finished booking | Goodwill. It never creates a debt, and it reduces income |
| Money to give back | Shows on Yorgos's Home page |
| New exports | Real Excel files, as D21 |
| ADR | What the guest pays for the house, after promo |
| Staff powers | As built; no Staff at launch |
| Empty channel feed | Releases only after 6 hours and two or more empty reads, with an alert. Any release of a future stay alerts Yorgos |
| Stale sync alert | 3 hours June to September, 6 hours otherwise |
| Closures made only on Airbnb | Do not copy to Booking.com; Yorgos blocks dates in Admin |
| Turnstile | Required in production: the form fails closed with phone and email shown if keys are missing |
| Old queued email | Rows older than 72 hours expire as Not sent, except booking confirmations |
| Maximum stay online | 30 nights by default, editable by the Owner |
| Spam protection on checkout | Turnstile required in production |
| Payment methods | Cards only, with Apple Pay and Google Pay |
| Card refunds | Owner only |
| Second payments | Stay manual, with an alert |
| Exporting checkout holds to channels | Off until real feeds are checked, because a hold could return as a false conflict and trigger a wrong refund (D16) |
| Contact details | Public details come from Text and photos. Property keeps legal details and the internal notification address, relabelled so the two cannot be confused |

### CMS review findings to fix before merging `feat/cms` (aa45931)

Send to the CMS agent (a7e15ead742227a56) on resume. Access, XSS and draft leaks are sound.
- D1 High: failed upload can leave a live section pointing at a deleted file. Roll back correctly and await `sectionResult` (`lib/cms/actions/photos.ts`).
- D2 High: two tabs overwrite each other's text. Save with `where updated_at = loaded value`, then show the page-changed message.
- D3: refuse publishing blank titles and contact fields.
- D4: at runtime throw instead of caching built-in fallback text, so Next keeps the last good page.
- D5: remove temp files in `finally`, and add a daily `cms/` cleanup job.
- D6: document imports before first deploy, and add a named production path for T7.2.
- D7: resolve the `package.json` conflict.
- D8: 404 page uses a fixed photo. D9: keep fallback `site/` files or use a code asset.
- D10: contact column `min-width: 0`, `nextOrder` max + 1, `safeHref` backslash, URLs with `)`, link prompt error, audit failure after publish, publish race, `beforeunload` on list and alt forms.
- Tests: run `cms-static.spec.ts` in CI with `CMS_STATIC_CHECK`, cover `limitInputPixels`, failure paths, removed admin.
- To check: real iPhone HEIC upload.

### Working defaults (D27, 2026-11-07)

Used for the autonomous block. Each can change later; YOU or HOST confirm them before launch. Anything Yorgos edits in Admin is only a starting value.

| Area | Default |
|---|---|
| Public email | `host@miloscasa.com`; Yorgos's personal Yahoo removed from the site. Phone and WhatsApp stay |
| Default language | English, with Greek chosen from the browser or the flags. Admin is Greek first (D25) |
| Sender | Name "Casa Filakopi", from `bookings@mail.miloscasa.com`, reply-to `host@miloscasa.com`. Each guest gets their booking's language |
| Reminders | Balance request at the due date plus one reminder 3 days later. Pre-arrival email 3 days before. Thank-you built but off |
| Payment | Stripe hosted Checkout, EUR, Apple Pay and Google Pay on; hold 35 min, session 30 min |
| Late refund | Tiers as seeded: 100% until 30 days out, then 0% |
| Pricing rules | Extra-guest fee per guest per night, children counted, promos also discount cleaning, taxes never discounted |
| Booking rules | Horizon 18 months, same-day until 12:00, Friday and Saturday weekend, minimum stay set by Yorgos |
| Prices, capacity, fees | Remain placeholders until HOST enters real ones (T6.9) |
| Analytics | None at launch, so no analytics cookies. Setting stays available |
| Data retention | Guest data anonymised 5 years after check-out, except what tax rules require. Confirm with ACC (question 15) |
| Accounts | Yorgos Owner, plus Spyros as a second Owner for lost-phone recovery. No Staff at launch; the role is built |
| Vrbo/HomeAway | Sync available as "Other iCal", off until HOST confirms the listing is active |
| Launch | March 2027 target. Real invoices wait for ACC (D20) |

## 3. How we work (multi-agent model)

**Principle:** serial until the contracts exist, parallel after. Most multi-agent failure comes from parallel work against a moving schema.

1. **LEAD** alone does Phases 0 to 2: decisions, scaffold, schema, RPCs, RLS, types. Agents working before this would each invent their own contracts.
2. **Contract freeze (Gate 2)** locks migrations, generated types and the domain function signatures.
3. **Waves 3 to 5:** one worker per track, each in its own git worktree on `feat/<track>`, merging into `dev-booking` through LEAD.
4. **File ownership:** each track owns its folders and no two tracks edit the same files. Only LEAD changes `supabase/migrations`; a worker needing a schema change asks LEAD.
5. **Independent review:** anything touching money, overbooking or RLS gets a separate reviewer agent that did not write it, before merge.
6. **Every merge requires:** lint, typecheck, tests green, plan items ticked, and a one-paragraph report.
7. **YOU approve at each Gate.** Commits and pushes happen when you say so. Anything outward-facing (DNS, live keys, emails to real people) is confirmed first.

---

## 4. Accounts and access tracker

Rule: **never paste a secret into this chat.** Keys go in `.env.local` (gitignored) or the Vercel dashboard, and I only see the variable names. I cannot create accounts or enter passwords, so these steps are yours. I will prompt you when each is needed; nothing is needed until Phase 1 ends.

| ID | Item | Needed by | Who | Status |
|---|---|---|---|---|
| A0 | Start Docker Desktop | Phase 1 | YOU | [x] |
| A1 | Set up `host@miloscasa.com` | Phase 2 end | YOU | [x] |
| A2 | Supabase staging project | Phase 2 end | YOU | [x] |
| A3 | Vercel project | Phase 2 end | YOU | [x] |
| A4 | Domain and DNS access | Wave 1 | YOU/HOST | [x] |
| A5 | Resend | Wave 1 | YOU | [x] |
| A6 | Stripe test mode | Wave 2 | YOU | [x] |
| A7 | Cloudflare Turnstile | Wave 2 | YOU | [ ] |
| A8 | Sentry | Phase 6 | YOU | [ ] |
| A9 | OTA iCal URLs | Wave 2 | HOST | [ ] |
| A10 | Stripe live activation | Phase 7 | HOST | [ ] |
| A11 | Supabase production (Pro) | Phase 7 | YOU | [ ] |

**A0 Docker:** open Docker Desktop from Applications and wait for "Engine running". Needed for local Supabase.

**A1 `host@miloscasa.com`:**
1. Log in to Namecheap, open `miloscasa.com`, and turn Auto-Renew on.
2. Advanced DNS, Mail Settings: keep Email Forwarding. Domain tab, Redirect Email: add alias `host` forwarding to your inbox. Add Yorgos's inbox too if forwarding allows more than one target.
3. Send a test email to `host@miloscasa.com`.
4. Use this address for A2, A3, A5, A7, A8, with 2-Step Verification on and recovery codes in a password manager.

**A1b Setup guides I give you when each step is reached:** domain DNS records for sending mail (A5), how Yorgos reads guest mail and replies from `host@miloscasa.com` (T4.18a), and Gmail setup if a dedicated inbox is wanted. **Stripe:** A6 for test mode, A10 for live.

**A2 Supabase staging:**
1. supabase.com, sign up with `host@miloscasa.com`. Create organization `Casa Filakopi`, plan Free.
2. New project: name `casa-filakopi-staging`, region `Central EU (Frankfurt)`, generate a strong database password and save it in the password manager.
3. Tell me the project ref only (the `abcdefgh` part of the dashboard URL).
4. In a terminal run `supabase login` yourself. It opens a browser.
5. LEAD then pushes `config.toml` settings, since sign-ups disabled and MFA do not reach a hosted project automatically.
6. After that push, set the sign-in rate limit to 15 in the dashboard, and check whether the plan offers the password and MFA verification hooks (ADMIN review finding 1). If not, YOU decide whether to accept Supabase's own limits for launch.

**A3 Vercel:**
1. vercel.com, sign up with GitHub (`SpyrosKas`), team name `casa-filakopi`.
2. Add New Project, import `SpyrosKas/CasaFilakopi`. Set Production Branch to `dev-booking` for now, so nothing touches the live site.
3. Upgrade to Pro only when going to production.

**A5 Resend:**
1. resend.com, sign up with `host@miloscasa.com`.
2. Domains, Add Domain, use `mail.<yourdomain>`, region `eu-west-1`.
3. Add the shown DNS records (needs A4). I will check them with you.
4. API Keys, create `staging` with Sending access, and paste it into `.env.local` as `RESEND_API_KEY`.

**A6 Stripe test mode:**
1. stripe.com, sign up with `host@miloscasa.com` for now. Do not activate payments yet.
2. Keep "Test mode" on. Developers, API keys: put them in `.env.local` as `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. In a terminal run `stripe login`.

**A7 Turnstile:** dash.cloudflare.com, sign up with `host@miloscasa.com`, Turnstile, Add site, domains `localhost` and the Vercel URL. Save the two keys as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.

**A8 Sentry:** sentry.io, sign up with `host@miloscasa.com`, create a Next.js project, region EU. Save the DSN as `SENTRY_DSN`.

**A9 OTA iCal (HOST):** from Airbnb (listing, Availability, Connect calendars, Export) and Booking.com (extranet, Rates & Availability, Sync calendars, Export), copy each listing's iCal URL. Also confirm whether the HomeAway/Vrbo listing is still active.

**A10 Stripe activation (HOST):** the legal owner completes Stripe's business profile: identity, tax details, IBAN. Must be done by that person in the Stripe dashboard.

---

## 5. Phases

### Phase 0: Decisions and tooling (LEAD, YOU)

- [x] T0.1 Read spec v2 and audit repo (`MIG-01`, first pass)
- [x] T0.2 Record spec conflicts and technical corrections (section 1)
- [x] T0.3 Add spec to repo as `docs/requirements.md`
- [x] T0.4 YOU answer D1, D2, D3
- [ ] T0.5 ACC answers D4 (question sheet in T0.9)
- [ ] T0.6 YOU answer D5, D6, confirm D7 to D14
- [x] T0.7 Install tooling: Supabase CLI, GitHub CLI, Stripe CLI, Node LTS (`.nvmrc`)
- [x] T0.8 A0: Docker running, `supabase --version` and `docker ps` verified
- [x] T0.9 Write `docs/accountant-questions.md` for ACC (Greek + English)
- [x] T0.10 Confirm live hosting and rollback path (`MIG-09`): `miloscasa.com` is served by Netlify from this repo's site. Rollback = point DNS back to Netlify; keep that site until T7.7

**Gate 0:** D5 and D6 answered, D7 to D14 confirmed, tools verified. D4 may stay open; only INV waits for it.

### Phase 1: Scaffold (LEAD, serial)

- [x] T1.1 Move static site to `legacy/`, remove tracked `.DS_Store`, add `.gitignore`
- [x] T1.2 Create Next.js App Router + TypeScript (strict) at repo root with pnpm
- [x] T1.3 Add ESLint, Prettier, Vitest, Playwright
- [x] T1.4 Project structure: `app/[locale]`, `app/admin`, `app/api`, `lib/domain`, `lib/db`, `emails`, `supabase`
- [x] T1.5 `next-intl` locale routing `/el`, `/en` (`WEB-06`)
- [x] T1.6 `supabase init`, local stack running (`SUP-01`)
- [x] T1.7 Env loader with Zod validation and `.env.example` (`PLT-03`)
- [x] T1.8 Server-only Supabase client guard so the service key cannot reach the browser (`SUP-07`)
- [x] T1.9 CI on GitHub Actions: lint, typecheck, format, unit, build, browser and database tests, plus a generated-types check (`PLT-04`). First run green on `dev-booking`
- [x] T1.10 Write `CLAUDE.md` with conventions, ownership and test commands
- [x] T1.12 Keep the app host-portable: `output: 'standalone'`, a Dockerfile, no Vercel-only features
- [x] T1.11 Capture legacy visual baselines at 375, 768, 1280 px for all 3 pages (`MIG-05`, `QA-06`)

**Gate 1:** `pnpm dev` serves a page, Supabase runs locally, CI is green, baselines are saved.

### Phase 2: Data foundation (LEAD, serial, reviewed)

Migrations (`SUP-02`, `SUP-03`):
- [x] T2.1 Enable extensions; `property`, `rooms`, `room_photos`, `amenities`, `settings`
- [x] T2.2 `inventory_claims` with `btree_gist` exclusion constraint (`SUP-04`) and partial `WHERE` for external conflicts
- [x] T2.3 `bookings`, `booking_nights`, `holds`, `guests`, `availability_blocks`, status enum (`BKG-11`, `SUP-11`)
- [x] T2.4 `rates`, `seasons`, `restrictions`, `taxes_fees`, `promo_codes`, `cancellation_policies`
- [x] T2.5 `payments`, `refunds`, `stripe_events` (idempotency)
- [x] T2.6 `invoices`, `invoice_lines`, `invoice_series` (tables only until D4)
- [x] T2.7 `external_calendars`, `external_events`, `sync_logs`
- [x] T2.8 `contact_messages`, `email_templates`, `email_logs`, `email_queue`
- [x] T2.9 `pages`, `content_blocks`, `faq`, `testimonials`, `places`, `media` (per language)
- [x] T2.10 `admin_profiles`, `audit_log`, `consent_log`, `job_runs`

RPCs (`SUP-05`):
- [x] T2.11 `create_hold`, including clearing expired overlaps
- [x] T2.12 `confirm_booking` (idempotent), `next_booking_reference` (`BKG-13`)
- [x] T2.13 `cancel_booking`, `record_refund`, `modify_booking`
- [x] T2.14 `next_invoice_number`, gapless (`INV-03`)
- [x] T2.15 `public_availability` returning no guest data (`AVL-09`)

Security and tooling:
- [x] T2.16 RLS on every table, roles enforced (`SUP-06`, `SUP-14`)
- [x] T2.17 Generated TS types in CI (`SUP-08`); seed scripts (`SUP-09`)
- [x] T2.18 Storage buckets and policies (`SUP-16`, `SUP-21`)
- [x] T2.19 DB tests: 50 concurrent overlapping holds, exactly one wins, plus the constraint alone under 30 concurrent blocks (`QA-02`)
- [x] T2.20 RLS tests for anon, token, staff, owner (`QA-03`)
- [x] T2.21 Domain function signatures in `lib/domain` (types only)
- [x] T2.22 Independent reviewer agent audits schema, RPCs and RLS. 5 high and 9 medium findings fixed, each with a regression test (`tests/db/review-regressions.test.ts`)
- [x] T2.23 A1, A2, A3: staging live; CI applies migrations to staging (`PLT-01`, `PLT-02`, `PLT-04`). Staging live: 8 migrations, seed and auth config pushed and verified; Vercel connected at https://casa-filakopi.vercel.app. Staging leaves out email templates (need custom SMTP) and session limits (need Pro): both to apply with Resend and at launch. CI does not yet apply migrations automatically: LEAD pushes them

**Gate 2, contract freeze:** concurrency and RLS tests green, review findings closed, YOU sign off. Parallel work starts here.

### Wave 1 (Phase 3): parallel

**Track WEB** (owns `app/[locale]`, `components/site`, `styles`)
- [x] T3.1 Extract tokens and import legacy CSS as global (`MIG-02`, `MIG-04`)
- [x] T3.1a Mobile-first layout for house sections: round photo no longer overlaps text at any width (fixes F11)
- [x] T3.1b Find and remove the cause of horizontal overflow on phones; check hero title legibility
- [x] T3.1c Automated Playwright check at 320, 375, 414, 768 px: no text/image overlap, no horizontal scroll, on every public page, in CI
- [x] T3.2 Header, footer, fullscreen menu, cookie-safe map embed (`WEB-10`)
- [x] T3.3 Home sections, carousels and modals in React (`MIG-03`)
- [x] T3.4 Host page; Directions page with accordions
- [x] T3.5 Scroll animations without jQuery
- [x] T3.6 New pages in same style: Gallery, Contact, FAQ, House rules, legal, 404 (`MIG-08`, `WEB-02`, `WEB-03`, `WEB-16`)
- [x] T3.7 Replace the "book via OTA" modal with the booking entry point
- [x] T3.8 301s from `index.html`, `host.html`, `directions.html` (`MIG-06`)
- [x] T3.9 Cookie consent, logged (`WEB-12`, `CMP-04`)
- [ ] T3.10 Visual diff against baselines, reviewed by YOU (`MIG-05`). Desktop should match; mobile differs on purpose (F11). Screenshots ready; waits for YOU

**Track ENGINE** (owns `lib/domain`)
- [x] T3.11 Availability calculation (`AVL-01`, `AVL-04`, `AVL-05`)
- [x] T3.12 Pricing engine: seasons, weekdays, overrides, extra guest, cleaning (`BKG-02`)
- [x] T3.13 Taxes, climate resilience fee, promo codes (`BKG-03`, `BKG-04`)
- [x] T3.14 Price breakdown and deposit split (`BKG-05`, `PAY-02`)
- [x] T3.15 Cancellation and refund calculation (`BKG-16`)
- [x] T3.16 Unit tests including Athens timezone and DST edges (`QA-01`, `SUP-11`)

**Track ADMIN** (owns `app/admin`, `components/admin`)
- [x] T3.17 Login, reset, invite-only, session timeout, rate limit (`SUP-12`, `ADM-01`, `ADM-03`)
- [x] T3.18 TOTP MFA, mandatory for Owner (`SUP-13`)
- [x] T3.19 Role middleware, admin shell, audit helper (`ADM-02`, `ADM-04`, `SUP-14`)
- [x] T3.20 Rooms, property and settings screens (`ADM-14`, `ADM-24`, `ADM-25`)
- [x] T3.20a Payment and cancellation rules screen for Yorgos: payment mode, deposit %, balance timing, cancellation tiers, with plain-language preview of what a guest will see (`PAY-02`, `BKG-16`, D6)
- [x] T3.20b Snapshot the rules onto each booking; a test proves editing rules leaves existing bookings unchanged (`CMP-03`)
- [x] T3.20c Admin works on a phone, since Yorgos will likely manage it from one

**Track MAIL** (owns `emails`, `lib/email`)
- [x] T3.21 A4, A5: domain verified with SPF, DKIM, DMARC (`EML-01`, `PLT-08`) (2026-11-08: DKIM, send/rsend CNAMEs and `_dmarc p=none` resolve; the 4 queued staging emails went out from bookings@mail.miloscasa.com and arrived. Resend delivery webhook `RESEND_WEBHOOK_SECRET` not set yet)
- [x] T3.22 Queue, retries, logging, Resend webhooks (`EML-07`, `EML-08`, `JOB-05`)
- [x] T3.23 Branded base layout, per-language (`EML-04`, `EML-05`)
- [x] T3.24 Contact flow: save, notify, reply-to, auto-reply, Turnstile, rate limit (`CNT-01` to `CNT-04`, `CNT-07`)

**Gate 3:** public site matches the old one, pricing tests green, admin login works. YOU approve the visual diff.

### Wave 2 (Phase 4): parallel

**Track PAY + checkout** (owns `app/[locale]/book`, `app/api/stripe`, `lib/payments`)
- [x] T4.1 A6: Stripe test mode; webhook forwarding by CLI (2026-11-08: staging keys in Vercel, event destination to /api/stripe/webhook; a 4242 test booking for 16–18 Nov, €284, confirmed from checkout.session.completed)
- [x] T4.2 Availability search and calendar widget (`WEB-04`, `WEB-05`)
- [x] T4.3 Checkout flow, server-side reprice, terms stored with version (`BKG-06`, `BKG-07`, `BKG-08`, `CMP-03`)
- [x] T4.4 Hold 35 min, Checkout Session 30 min (`BKG-09`, `BKG-10`, `PAY-01`)
- [x] T4.5 Webhook: signature, idempotent, all events (`PAY-04`, `PAY-05`, `BKG-12`). LEAD adds the dispute open/close RPC
- [x] T4.6 Failed or abandoned payment (`PAY-10`)
- [x] T4.7 Paid-after-hold-lost: auto-refund and alert
- [x] T4.8 Confirmation page and emails (`EML-02`, `EML-03`)
- [x] T4.9 Guest token page: view, pay balance, cancel, message (`BKG-15`, `SUP-15`, `CNT-06`)
- [x] T4.10 Balance links and reminders (`PAY-03`, `JOB-03`)
- [ ] T4.11 Integration tests with Stripe CLI (`QA-04`)

**Track ADMIN-OPS** (owns `app/admin/bookings`, `app/admin/calendar`)
- [x] T4.12 Dashboard (`ADM-05`)
- [x] T4.13 Availability calendar and blocking (`AVL-02`, `AVL-03`, `AVL-06`, `AVL-10`)
- [x] T4.14 Rates calendar, bulk edit (`AVL-07`, `ADM-11`)
- [x] T4.15 Restrictions, taxes, promos, policies (`ADM-12`, `ADM-13`)
- [x] T4.16 Bookings list and detail, export (`ADM-06`, `ADM-07`, `ADM-09`)
- [x] T4.17 Booking actions: manual, modify, cancel, refund, payment (`ADM-08`, `BKG-17`, `BKG-18`, `PAY-06`, `PAY-07`, `PAY-11`)
- [x] T4.18 Messages inbox (`CNT-05`, `ADM-21`)
- [x] T4.18a Yorgos can read all guest messages and replies in Admin, and they also reach `host@miloscasa.com`
- [x] T4.18b Write-to-guest box on any booking or message: pick a template or type freely, send, and it is logged on the booking. Replies come back to `host@miloscasa.com`

**Track CMS** (owns `app/admin/content`, `app/admin/media`, `scripts/migrate-media`)
- [x] T4.19 Migrate 68 images to `media` bucket and rewrite references (`SUP-17`, `SUP-18`)
- [x] T4.20 Next Image loader with transforms (`SUP-19`)
- [x] T4.21 Move hardcoded text into DB (`MIG-07`, `WEB-07`)
- [ ] T4.22 Greek translation drafts for HOST review (`WEB-06`)
- [x] T4.23 Page editor, draft/publish/preview, revalidation (`ADM-15`, `ADM-19`, `WEB-08`)
- [x] T4.24 Media library, upload, alt text, safe delete (`SUP-20`, `ADM-16`)
- [x] T4.24a Per-section photo manager: upload from phone or computer, delete, drag to rearrange, choose cover, and it appears on the site without a developer (`ADM-14`, `ADM-16`, `WEB-08`)
- [x] T4.24b Oversized phone photos auto-resized on upload, and any photo stays usable on mobile layouts
- [x] T4.25 FAQ, legal, testimonials, places, SEO fields (`ADM-17`, `ADM-18`)

**Track CHN** (owns `lib/channels`, `app/admin/integrations`, `app/api/ical`)
- [x] T4.26 Provider adapter interface (`CHN-17`)
- [x] T4.27 Settings, toggles, URL validation (`CHN-01` to `CHN-05`, `ADM-28`)
- [x] T4.28 Import job with UID upsert, sync now (`CHN-06` to `CHN-09`, `JOB-02`)
- [x] T4.29 Export feed, token, no loops (`CHN-10` to `CHN-12`)
- [x] T4.30 Conflicts, sync logs, alerts, limitation notice (`CHN-13` to `CHN-16`)
- [ ] T4.31 Fixture-feed tests, then A9 real-feed test (`QA-04`). Fixture tests done; real feeds outstanding, and they decide whether exporting holds can ever be on
- [ ] T4.32 Schedule the jobs: `pg_cron` with `pg_net` every 5 minutes calling `/api/cron/*`, secrets in Vault per environment, `CRON_SECRET` in Vercel. Migration 14 done; site jobs wait for Vault secrets and `CRON_SECRET` per environment (D9 decided)

**Gate 4:** full test-card booking on staging, blocked dates show on the public site, an Airbnb test block arrives in our calendar and ours arrives in Airbnb.

### Wave 3 (Phase 5): parallel, final INV rules wait for D4

**Track INV** (owns `lib/invoicing`, `app/admin/invoices`). Started early under D17
- [ ] T5.1 Rescope against ACC answers; list what is removed. Done last, when D4 is answered
- [ ] T5.2 Document issuing, immutable, triggers (`INV-01` to `INV-04`, `INV-07`). Issuing, PDF and immutability done; automatic triggers wait for Stripe
- [x] T5.3 Credit notes (`INV-05`)
- [ ] T5.4 PDF, private storage, email attachment (`INV-06`). PDF and storage done; email attachment and guest download wait for D4
- [ ] T5.5 myDATA adapter, retries (`INV-08`, `INV-09`, `JOB-06`)
- [ ] T5.6 OTA booking invoices (`INV-10`)
- [x] T5.7 List, export, settings (`INV-11`, `INV-12`, `ADM-22`, `ADM-26`)
- [x] T5.7a Download one document, or select several or all matching a filter, as a PDF or a ZIP plus Excel file. Marking as sent stays a separate step

**Track OPS**
- [x] T5.8 Editable email templates, remaining emails (`EML-02`, `EML-03`, `EML-06`, `EML-09`, `ADM-27`)
- [x] T5.8a Scheduled messages: Yorgos sets rules like "7 days before arrival" or "1 day after check-out", per language, on/off, plus one-off sends at a chosen date on a single booking
- [ ] T5.8b Automatic guest emails verified end to end: booking confirmation, payment confirmation, reminders, and invoice/receipt once D4 is answered
- [ ] T5.9 All scheduled jobs with logging and alerts (`JOB-01`, `JOB-04`, `JOB-07`, `JOB-09`)
- [x] T5.10 Guests, GDPR export/anonymise, retention (`ADM-20`, `CMP-01`, `CMP-02`, `JOB-08`). Anonymise must cover `bookings.guest_*` and `special_requests`, `email_logs`, `contact_messages`, `external_events.guest_*`, `stripe_events.payload`
- [x] T5.11 Reports, user management, languages (`ADM-23`, `ADM-29`, `ADM-30`)
- [x] T5.12 SEO: sitemap, hreflang, schema.org (`WEB-09`); analytics after consent (`WEB-13`); registry number (`WEB-15`, `CMP-05`)

**Gate 5:** every spec ID is either ticked or explicitly descoped in the Decisions log.

### Phase 6: Hardening (QA, LEAD)

- [x] T6.1 Playwright E2E: booking, contact, manual booking, block, cancel with refund, sync conflict (`QA-05`)
- [ ] T6.2 Lighthouse 90+ and WCAG 2.1 AA in CI (`WEB-01`, `WEB-14`, `QA-07`)
- [x] T6.3 Security headers, CSP, Zod, rate limits (`PLT-05`)
- [ ] T6.4 Full `/security-review`; independent review of payment and RLS paths
- [ ] T6.5 Sentry, uptime, structured logs (`PLT-06`, `PLT-07`)
- [ ] T6.6 Backup and tested restore on staging (`SUP-10`)
- [x] T6.7 README, runbook, ER diagram, host guide in Greek and English (`DOC-01` to `DOC-04`)
- [x] T6.8 Late-payment and double-webhook drills
- [x] T6.11 Calendar feedback (2026-11-07): past dates faded, price per night on each free date, general minimum stay in Admin → Booking settings next to the maximum, and a clear message on a too-short or too-long stay, in the calendar and from the server
- [x] T6.12 Speed (2026-11-08): Vercel functions pinned to `dub1` next to Supabase `eu-west-1` (`vercel.json`); fewer sequential database trips in the calendar and quote; the return page asks every second for the first 15 s. Staging: calendar data 1.7–3.8 s → ~0.5 s, quote ~1.5 s → ~0.22 s, booking page 1.5–3 s → ~0.4 s. Home LCP on staging is the hero at ~1 s; the Next "LCP image" warnings in the test logs come from the tests scrolling, so no change there
- [x] T6.13 Checkout country dropdown (2026-11-08): countries in the guest's language, picking one fills the phone dialling code, still editable; the booking keeps the English country name
- [ ] T6.14 Admin menu in groups (2026-11-08): Guests and money, Prices and stays, Website, Setup; staff see only their links
- [ ] T6.15 Dependabot alert #5: jQuery 3.2.1 in the legacy site on `master` (`js/jquery-3.2.1.min.js`), fixed in 3.4.0. Needs YOU to approve touching `master`, or it goes away at T7.5/T7.7

- [ ] T6.9 HOST sets real starting values for payment and cancellation rules in Admin
- [ ] T6.10 HOST test, unaided: change a cancellation rule, upload, delete and reorder photos, from a phone

**Gate 6:** HOST walks through the admin and a test booking on staging and approves.

### Phase 7: Launch (YOU, HOST, LEAD)

- [ ] T7.1 A10, A11: Stripe live, Supabase production, Vercel Pro
- [ ] T7.2 Production migrations, seed real rates and content
- [ ] T7.3 Import existing future bookings from OTAs before opening sales
- [ ] T7.4 One real low-value booking, refund it
- [ ] T7.5 Merge `dev-booking` to `master`; DNS switch with low TTL (`MIG-09`)
- [ ] T7.6 Monitor for 72 hours; keep legacy site ready for rollback
- [ ] T7.7 Remove `legacy/` and handover
