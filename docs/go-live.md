# Go-live checklist

Claude follows this to move `miloscasa.com` from the old Netlify site to the new booking site. Start only after Spyros gives the final OK in chat. Work top to bottom. Tick each box only after checking the result, as in `docs/PLAN.md`.

**Who does what**
- **YOU** is Spyros.
- **HOST** is Yorgos.
- **ME** is Claude.

Every step that needs YOU or HOST gets exact click-by-click steps in chat when it comes up.

**Rules that still apply**
- Secrets go only into Vercel or a Terminal `read -s` prompt, never into chat, the repo or the browser.
- Every write to a hosted Supabase project needs YOU's OK in chat at that moment. Use `--read-only` for anything else.
- Before any hosted command, check the target project. Staging is `iecsohriashrdbqcelkl`. Production gets its own ref in step 1.3, written here.
- The old site in `legacy/` and on Netlify stays untouched until step 7, and its Netlify project stays alive until step 8.
- Merging to `master` and changing DNS each need YOU's explicit OK, even inside this checklist.

Production ref: `________` (fill in at 1.3)

---

## 0. The final OK

Start only when all of these are true. Ask YOU to confirm each one in chat.

- [ ] **Accountant (D4) answered**, and invoices and myDATA rebuilt to match (T5.1 to T5.6). Otherwise YOU decides in writing to launch without automatic invoices.
- [ ] **HOST has set real prices**, payment mode and cancellation rules on staging, and checked them (T6.9).
- [ ] **HOST passed the unaided phone test** (T6.10).
- [ ] **HOST approved the Greek texts** (T4.22).
- [ ] **YOU approved the visual check** against the old site (T3.10).
- [ ] **The Airbnb and Booking.com calendar links work on staging** (A9, T4.31).
- [ ] **Stripe live is activated by HOST** (A10): business profile, identity and IBAN done, and the Stripe dashboard shows no "Action required".
- [ ] **No open alerts on staging.** Admin Home shows no warnings. Every job in `job_runs` succeeded in the last 24 hours, and the last CI run on `dev-booking` passed.
- [ ] **A launch date is agreed**, on a weekday morning, Athens time, outside a busy booking week.

Then announce to YOU: "Starting go-live. The old site stays up until step 7."

## 1. Accounts and production project (a day or more before)

1. [ ] **Vercel Pro** (YOU): Settings, Billing, upgrade the team. Check the functions region is still `dub1` (`vercel.json`).
2. [ ] **Supabase organisation to Pro** (YOU): Billing, Pro plan. Production needs backups and must never pause.
3. [ ] **New Supabase project** (YOU):
   - Name `casa-filakopi-production`, region **West EU (Ireland), eu-west-1**, the same region as staging and Vercel's `dub1`.
   - Generate a strong database password and store it in the password manager.
   - YOU tells ME only the project ref. Write it at the top of this file.
4. [ ] **Production remote in `supabase/config.toml`** (ME): add `[remotes.production]` with `project_id`. Set `site_url = "https://miloscasa.com"` and `additional_redirect_urls = ["https://miloscasa.com/admin/auth/confirm", "https://www.miloscasa.com/admin/auth/confirm"]`, plus the same rate-limit, email and OTP blocks as staging. Commit to `dev-booking`.
5. [ ] **Supabase Auth email through Resend** (YOU, ME guides): Authentication, Emails, SMTP settings.
   - Host `smtp.resend.com`, port 465, user `resend`, password a new Resend key named `production-smtp` (Sending access only).
   - Sender `bookings@mail.miloscasa.com`, name `Casa Filakopi`.
   - This is what lets the custom invite and reset email templates and the session limits (Pro) be pushed.
6. [ ] **Sentry** (YOU, A8) if not already done: EU project, DSN host `*.ingest.de.sentry.io`.
7. [ ] **Uptime monitor** (YOU, ME guides): a free monitor such as UptimeRobot, signed up with `host@miloscasa.com`, on `https://miloscasa.com/api/health` and `https://miloscasa.com/en`, alerting `host@miloscasa.com`. Create it now and switch it on after step 7.
8. [ ] **Lower the DNS TTL** (YOU, ME guides): at Namecheap, Advanced DNS, set the TTL on the `@` A record and the `www` CNAME to 5 min (or the lowest offered).
   - Change nothing else.
   - Do this at least 24 hours before step 7.
   - Record the current values here for rollback: `@` A `104.198.14.52`, `www` CNAME `focused-newton-bdf5be.netlify.com.` (read 2026-11-08; re-read on the day with `dig`).

## 2. Production database

All writes here need YOU's OK at the time.

1. [ ] `supabase projects list`: confirm the production ref. Link it with `supabase link --project-ref <prod-ref>`.
2. [ ] **Migrations:** `supabase db push --linked`. Read the project name it prints before confirming. Then `supabase migration list --linked` must match `supabase/migrations` exactly.
3. [ ] **Auth config:** `supabase config push --project-ref <prod-ref>`. Then check in the dashboard:
   - sign-ups disabled
   - MFA (TOTP) on
   - site URL and redirect URLs as in 1.4
   - sign-in rate limit 15
   - session timebox 12h
4. [ ] **Base data:** load `supabase/seed.sql` into production (`psql` with the production connection string from a `read -s` prompt, or the SQL editor). Then **immediately** replace the dummy business details (the `invoicing` setting's `issuer`, and the `TEST-` invoice series prefixes) with the real ones from the accountant's answers. Staging's demo bookings (`seed:invoices`) are never loaded into production.
5. [ ] **Content and photos:** with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (from `read -s`) in the shell, run `pnpm migrate:content --production=<prod-ref>`, then `pnpm migrate:media --production=<prod-ref>`, then `unset SUPABASE_SECRET_KEY`.
6. [ ] **Copy HOST's staging edits:** list what HOST changed on staging in Text, Photos, House, Prices, Rules and Scheduled messages (compare staging with a fresh import). Re-enter them in production Admin (step 4.3), or copy the specific `content_blocks`, `settings` and `seasons` rows with a reviewed SQL script.
7. [ ] **Vault secrets for the scheduler:** `site_url` = `https://miloscasa.com`. `cron_secret` = a new `openssl rand -hex 32` value that YOU creates in Terminal and enters with `read -s`. The same value goes into Vercel's Production `CRON_SECRET` (step 3). Never reuse staging's value.
8. [ ] **RLS check on production:** run the anonymous-key probe from the T6.4 review. Only the 10 public-content tables may answer, and `media.created_by` must be refused.

## 3. Vercel production settings

Set these in Project Settings, Environment Variables, scope **Production only**. Staging keeps its own values under **Preview** for `dev-booking`.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://miloscasa.com` |
| `NEXT_PUBLIC_INDEXABLE` | leave empty: indexing turns on by itself for production on `miloscasa.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | production publishable key |
| `SUPABASE_SECRET_KEY` | production secret key (YOU pastes it) |
| `RESEND_API_KEY` | new Resend key `production`, Sending access |
| `RESEND_WEBHOOK_SECRET` | from the production webhook in 3.3 |
| `CRON_SECRET` | the value from 2.7 |
| `GUEST_TOKEN_SECRET` | new `openssl rand -base64 32`. Never change it after launch |
| `STRIPE_SECRET_KEY` | live `sk_live_…` (or a restricted key with the same rights) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | from the live webhook in 3.2 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | the existing widget, with `miloscasa.com` and `www.miloscasa.com` added to its hostnames (3.4) |
| `SENTRY_DSN` | from 1.6 |

1. [ ] **Production branch:** Settings, Git, Production Branch: change from `dev-booking` to `master`. From then on, `dev-booking` deploys are previews, and staging is the `dev-booking` preview URL (or a `staging` domain alias). Re-point staging's Vault `site_url` and Stripe test webhook if its address changes.
2. [ ] **Stripe live webhook** (YOU, live mode): Developers, Webhooks, Add endpoint `https://miloscasa.com/api/stripe/webhook`. Events:
   - `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   - `payment_intent.payment_failed`
   - `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
   - `refund.created`, `refund.updated`, `refund.failed`

   Copy its signing secret into Vercel. In Settings, Branding, set the name and logo shown on Checkout. In Settings, Public details, set the statement descriptor `CASA FILAKOPI`.
3. [ ] **Resend production webhook:** Webhooks, add `https://miloscasa.com/api/email/webhook` with the email events (`email.delivered`, `email.bounced`, `email.failed`, `email.suppressed`). Its secret goes into Vercel.
4. [ ] **Turnstile:** Cloudflare, Turnstile, the widget, Hostnames: add `miloscasa.com` and `www.miloscasa.com`. Keep `casa-filakopi.vercel.app` for staging.
5. [ ] **Domains:** Vercel, Settings, Domains: add `miloscasa.com` and `www.miloscasa.com`, with the bare domain primary and `www` redirecting to it. Vercel shows the DNS values to use, such as an A record `76.76.21.21` and the CNAME `cname.vercel-dns.com`. Copy them here. **Do not change DNS yet.**

## 4. Merge and first production deploy (still on the Vercel address)

1. [ ] **Final checks on `dev-booking`:** `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm test:db`, `pnpm test:e2e`, `pnpm test:static`, `pnpm test:pay`, `pnpm test:prod`. Then a green CI run, including Lighthouse.
2. [ ] **Merge `dev-booking` into `master`** (YOU's OK). Open a PR `dev-booking` → `master`, check the diff, and merge it once YOU says so.
   - `master` currently holds the old static site. The merged `master` keeps `legacy/` as files only; it is not served.
   - Netlify builds from `master` too. Before merging, ask YOU to **stop Netlify auto-publishing** (Netlify, Site configuration, Build & deploy, "Stop builds"), so the live old site stays exactly as it is.
3. [ ] **First production deploy:** Vercel builds `master`. Open the production deployment's own `*.vercel.app` URL and check:
   - `/en` and `/el` show the real content and photos.
   - `/api/health` returns `{"status":"ok"}`.
   - The page source still has `noindex`: it is not on `miloscasa.com` yet.
4. [ ] **First Owner** (runbook, "First Owner"): create `host@miloscasa.com` in production Auth.
   - Insert the `admin_profiles` row (YOU's OK).
   - HOST signs in, sets up two-step sign-in and saves the recovery codes.
   - HOST adds the second Owner (YOU) from Users.
5. [ ] **HOST checks Admin on production:** prices, rules, payment mode, scheduled messages, email settings (host address, send hour), the business details, and the house text and photos.
6. [ ] **Channel sync on production:** paste the Airbnb and Booking.com import links into Channel sync. Run "Sync now" and check the booked nights appear in Calendar.
7. [ ] **Import existing future bookings** (T7.3): for every future Airbnb and Booking.com reservation, check it came in through sync. Add each direct or phone booking HOST already has as a manual booking, with guest details and amount. Compare the next 12 months night by night with HOST's own list. **Nothing opens for sale until this matches.**
8. [ ] **Export link to the channels:** copy production's export link from Channel sync. HOST replaces any staging link in Airbnb and Booking.com, Import calendar. Wait for one channel fetch and check a production-only block shows there.
9. [ ] **Scheduler:** wait 10 minutes. Then, read-only:
   - `cron.job_run_details` shows the jobs running.
   - `net._http_response` is all 200.
   - `job_runs` has a `job_health` row.

## 5. Live test booking (still on the Vercel address)

1. [ ] YOU books 1 to 2 nights at the lowest real price with a real card, on the production `*.vercel.app` URL.
2. [ ] Check:
   - Stripe live shows the payment.
   - The webhook answered 200.
   - The booking is `confirmed` with its reference.
   - The dates are blocked in Calendar and in the export feed.
   - The guest confirmation, payment receipt and host notice emails arrived at real inboxes.
   - The guest link opens the booking.
3. [ ] **Refund it from Admin** (cancel with refund). Check:
   - Stripe shows the refund.
   - The booking is cancelled.
   - The dates are free again.
   - The refund email arrived.
   - Any invoice or credit note matches what the accountant asked for.
4. [ ] **Contact form:** send one message. It reaches the Workspace inbox and the auto-reply arrives.

## 6. Clean up staging

1. [ ] Follow runbook "Clear staging before launch", only after checking twice that the linked project is staging. Afterwards, `supabase link --project-ref <prod-ref>` is **not** the default: keep staging linked for day-to-day work.

## 7. DNS switch (YOU's OK, in the agreed morning slot)

1. [ ] Re-read the current records with `dig` and compare them with step 1.8.
2. [ ] **YOU at Namecheap, Advanced DNS** changes only these two:
   - `@` A record: `104.198.14.52` → the Vercel value from 3.5.
   - `www` CNAME: `focused-newton-bdf5be.netlify.com.` → `cname.vercel-dns.com.`
   - **Do not touch** MX (`smtp.google.com`), SPF and DKIM TXT records, `google._domainkey`, the Google site-verification TXT, `_dmarc`, `resend._domainkey.mail`, `send.mail`, `rsend.mail`, or anything under `mail`. Mail must keep working.
3. [ ] Vercel, Domains: wait for both domains to show valid configuration and an issued certificate.
4. [ ] Check from outside:
   - `curl -sI https://miloscasa.com/en` is 200 from Vercel.
   - `https://www.miloscasa.com` redirects to the bare domain.
   - Old URLs (`/index.html`, `/host.html`, `/directions.html` and the rest in the `next.config.ts` redirects) land on the right new pages.
   - The page now has **no** `noindex`.
   - `/sitemap.xml` and `/robots.txt` list `miloscasa.com`.
5. [ ] Mail still works: send a test email to `host@miloscasa.com` from outside, and trigger one Resend email (contact form).
6. [ ] Switch on the uptime monitor from 1.7.
7. [ ] **Google Search Console** (YOU, ME guides): add the `miloscasa.com` domain property (DNS TXT already verified by Workspace, or add one), submit `https://miloscasa.com/sitemap.xml`.
8. [ ] Tell HOST the site is live. From now on, bookings come in for real.

## 8. First 72 hours (T7.6)

Check at about +1 h, +6 h, +24 h, +48 h and +72 h:

- [ ] Admin Home: no alerts.
- [ ] `job_runs`: no failures. `email_logs`: nothing stuck in `queued` or `failed`.
- [ ] Vercel logs: filter `"level":"error"`. Sentry: no new issues.
- [ ] Stripe: webhook deliveries all succeeded.
- [ ] Channel sync: last sync recent for each feed, no conflicts. Spot-check one channel calendar against Admin.
- [ ] Search Console: no crawl errors on the redirects.

Keep the Netlify site and its project for at least 2 weeks after launch: it is the rollback.

## Rollback

Use this if the new site cannot take bookings safely and a fix is more than about an hour away.

1. YOU at Namecheap puts back the two records from step 1.8 (A `104.198.14.52`, `www` CNAME `focused-newton-bdf5be.netlify.com.`). With TTL at 5 minutes, most visitors are back on the old site within minutes.
2. In Admin, close checkout: remove the Stripe keys in Vercel Production and redeploy. The booking page then shows dates and points guests to the host. Production data stays as it is.
3. Tell HOST to take bookings by phone and through the channels only.
4. Tell any guest who paid in the gap from their booking's email. Their bookings stay valid in production.
5. Fix on `dev-booking`, re-run steps 4.1 and 5, then repeat step 7.

## 9. Handover (T7.7, after 2 quiet weeks)

1. [ ] Raise the DNS TTL back to Automatic.
2. [ ] Delete the Netlify site (YOU's OK). Remove `legacy/` and the baseline scripts on `dev-booking`, then merge to `master`.
3. [ ] Rehearse one restore of a Supabase daily backup into a new throwaway project (T7.1), and mark the runbook step rehearsed.
4. [ ] Diary reminders for YOU: Namecheap renewal (2027-04-11, auto-renew on), secret rotation once a year (runbook), and a quarterly `scripts/backup.sh <prod-ref>` copy to private storage.
5. [ ] Update `docs/PLAN.md`: tick T7.1 to T7.7 and refresh the status line.
