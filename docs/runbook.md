# Runbook

What to do when something needs a person. Written for whoever looks after the site, not for Yorgos: he has [host-guide.md](host-guide.md).

Before any command against a hosted project, check which one you are on: `supabase projects list` shows the linked project. Staging and production are separate Supabase projects.

Status of this document: procedures marked **Not yet rehearsed** have not been tried on a hosted project. T6.6 rehearses backup and restore on staging.

## First Owner

Sign-ups are closed, so the first Owner is created by hand, once per environment.

1. Supabase dashboard, Authentication, Users, Add user. Use `host@miloscasa.com` and a long password.
2. Copy the user's id, then in the SQL editor:

   ```sql
   insert into public.admin_profiles (id, role, display_name)
   values ('<user id>', 'owner', 'Yorgos');
   ```

3. Sign in at `/admin`. The panel requires two-step sign-in before anything else.
4. Add the second Owner from Users (D27). This is what makes lost-phone recovery possible.

## Removing an Owner

Any Owner can remove another, by typing their email in full. The same typing is needed to make someone an Owner, to invite one, and to make an Owner Staff. The database refuses to remove or demote the last Owner, however it is asked. Deleting the auth user itself in the Supabase dashboard is the one way past that, so do not.

Removing someone bans the account, ends its sessions and takes away the role. The account stays, because invoices name who issued them. Inviting the same email again replaces the password with a random one, so they have to choose a new one from the email. An old authenticator stays until an Owner resets it.

## Backups and restore

Production runs on Supabase Pro, which keeps daily backups. Staging on the free plan has none (D10). Whether to buy point-in-time recovery is an open decision for SUP-10.

The database holds everything except the files in Storage. Photos in `media` can be re-imported with `pnpm migrate:media`, but anything Yorgos uploaded later cannot, and invoice PDFs in `invoices` are tax records. Daily backups do not include Storage objects, so copy the `invoices` bucket regularly.

**To restore** (Not yet rehearsed):

1. Stop new bookings first: pause the project's web deployment in Vercel, or show maintenance, so nothing is written on top.
2. Supabase dashboard, Database, Backups: restore the chosen day. This replaces the whole database and takes the project offline for a while.
3. Check `supabase migration list` matches the code.
4. Open the Stripe dashboard. Anything paid after the backup is not in the restored database. Stripe keeps the events for 30 days, so resend them from Developers, Events. Handling is idempotent on `stripe_events.id`.
5. Run each channel sync once from Channel sync, so imports catch up.
6. Check Home for alerts, and compare the next 90 days of bookings with Airbnb and Booking.com by eye.
7. Reopen the site.

An anonymised guest can come back with a restore. Afterwards re-run `select public.anonymise_guest(id, null)` for anyone who asked to be removed since that backup. Keep that list somewhere outside the database: the `anonymise` entries in `audit_log` give the guest ids, and they are in the backup only up to its date.

## Secret rotation

Rotate on a schedule, and at once if a secret may have leaked. Never paste one in chat or a ticket.

| Secret | Steps | Side effect |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Create a new key in Supabase, set it in Vercel, redeploy, then delete the old key | Sign-in attempt counters reset, since they are keyed by it. Admin activity cookies are invalidated, so admins sign in again |
| `CRON_SECRET` | Pick a new value. Set it in Vercel and redeploy. Then `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '<new>');` | Jobs fail with 401 between the two steps. A few minutes is harmless |
| `GUEST_TOKEN_SECRET` | Avoid. Set a new value and redeploy | **Every guest link already sent stops working** |
| `RESEND_API_KEY` | New key in Resend, set in Vercel, redeploy, delete the old | Queued email waits and then goes |
| `RESEND_WEBHOOK_SECRET` | Roll in Resend, set in Vercel, redeploy | Events during the gap retry |
| `STRIPE_SECRET_KEY` | Roll in Stripe, set in Vercel, redeploy | None for hosted Checkout already open |
| `STRIPE_WEBHOOK_SECRET` | Roll in Stripe with an overlap period, set in Vercel, redeploy | Stripe retries failed events |
| `TURNSTILE_SECRET_KEY` | Rotate in Cloudflare, set in Vercel, redeploy | Contact form refuses briefly |
| iCal export link | Regenerate in Channel sync, then paste the new link into Airbnb and Booking.com | The channels stop seeing new bookings until the link is updated, so do both at once |
| An import link | Get a new one from the channel, paste it in Channel sync | None |

## Lost phone: an Owner cannot do two-step sign-in

Two-step sign-in has no recovery codes. Recovery is the other Owner, which is why there are two (D27).

**The other Owner can sign in:**

1. Check it really is them: call them on a known number. An email saying "I lost my phone" is not proof.
2. Admin, Users, find the person, Reset two-step sign-in. This is recorded in the audit log, and ends all their sessions.
3. They sign in with their password and set up a new authenticator straight away.

**Both Owners are locked out** (Not yet rehearsed):

1. In the Supabase dashboard, SQL editor, find the user and remove their factor:

   ```sql
   select id from auth.users where email = 'host@miloscasa.com';
   delete from auth.mfa_factors where user_id = '<user id>';
   ```

2. They sign in and enrol again, then reset the other Owner from Users.

Access to the Supabase dashboard is therefore the real master key: protect the account behind `host@miloscasa.com` with its own second factor, and keep its recovery codes on paper.

**Password forgotten:** the forgot-password link on the sign-in page. The two-step code is still asked for afterwards.

## Stripe disputes

A dispute (chargeback) means the guest's bank has pulled the money back until the case is decided. Stripe emails the account, and the app sends Yorgos `host_dispute_opened`. The payment shows as disputed. Reports still count it as money received until settled.

1. Open the dispute in Stripe. The deadline there is strict, usually one to three weeks.
2. Gather evidence: the booking page, the terms version and timestamp stored on the booking, emails from Emails, and any messages.
3. Submit through Stripe.
4. Removing this guest's details is refused while the dispute is open, so the evidence stays.
5. The outcome reaches the booking by itself through Stripe's webhook: won clears the dispute, and lost is recorded like a refund, because the money has gone. After a lost dispute, ask the accountant what document is needed.

## Sync conflicts

The calendar imports Airbnb and Booking.com every 5 minutes. An imported stay that overlaps something already sold is stored and flagged, not rejected, so nothing is lost (CHN-13).

What Yorgos sees: an email, and a red notice on Home with a link to the stay.

1. Find out who really holds the dates: look on Airbnb or Booking.com.
2. If the channel booking is real, cancel ours, with a refund. If it is a false event, such as a block copied back, remove it on the channel and it clears at the next sync.
3. A paid checkout that lost its dates to an import refunds itself and alerts the host (D16).

Other alerts:

- **Sync failed N times:** the feed link is wrong or the channel is down. Check the link in Channel sync.
- **Stale:** no good read for 3 hours June to September, 6 hours otherwise.
- **Empty feed:** dates release only after 6 hours and two or more empty reads, with an alert. Any release of a future stay alerts Yorgos. Check that the channel really has nothing.

## Failed email

Emails queue in `email_logs` and a job sends them every minute. Failed sends retry with a delay, and old queued rows expire as Not sent after 72 hours, except booking confirmations.

1. Admin, Emails, shows status per email. Resend one from there.
2. A **bounced** guest address tells Yorgos by email. Get a good address by phone and change it on the booking.
3. Nothing at all is going out:
   - `RESEND_API_KEY` wrong or missing: the log event is `email.stopped`, and the job fails. Queued mail waits.
   - Jobs not running: Home shows "scheduled jobs have not run". See Jobs below.
   - Domain: `mail.miloscasa.com` must keep its DNS records in Namecheap.
4. Repeated failures email the host, though if email itself is broken only Home can tell you.

## Failed invoice export

Documents are provisional until the accountant confirms (D17, D20), and nothing goes to guests. myDATA is Off: Yorgos prepares a file and the accountant uploads it.

1. Admin, Invoices and receipts, Prepare for the accountant. Filter by month.
2. If the ZIP or Excel fails, try a shorter period. A document with no PDF is listed: open it and create the PDF again.
3. A PDF missing from storage: issued documents are immutable and the data is in `invoices` and `invoice_lines`, so it can be rebuilt without changing the number.
4. Marked as sent by mistake: `exported_at` is a delivery field. It can be cleared in SQL, with a note of why.
5. Never edit an issued document in SQL. A trigger refuses it, and a credit note is the correct fix.

## Jobs

`job_runs` holds what each job did. Database jobs run in `pg_cron`. Site jobs are called by `pg_net` with `CRON_SECRET`.

| Job | When | Where |
| --- | --- | --- |
| `release_expired_holds` | Every minute | Database |
| `complete_finished_bookings` | Daily | Database |
| `purge_admin_attempts` | Daily | Database |
| `apply_retention` | Daily | Database |
| Email queue | Every minute | `/api/cron/email` |
| Scheduled emails | Hourly | `/api/cron/email/scheduled` |
| Channel sync | Every 5 minutes | `/api/cron/channel-sync` |
| Temp upload cleanup | Daily | `/api/cron/cms` |
| Job health | Hourly | `/api/cron/health` |

**Home says a job failed:** in SQL, `select * from job_runs where job = '<name>' order by id desc limit 5;`. After three failures in a row the host gets one email a day per job.

**Home says the site's jobs have not run:** the health job has not reported for 3 hours.

```sql
select name from vault.decrypted_secrets where name in ('site_url', 'cron_secret');
select jobname, status, return_message, start_time from cron.job_run_details
  order by start_time desc limit 20;
select id, status_code, error_msg from net._http_response order by id desc limit 20;
```

- A secret is missing: `select vault.create_secret('<value>', 'cron_secret');` and the same for `site_url`, `https://<host>`.
- 401: the Vault value and Vercel's `CRON_SECRET` differ.

## Guest data requests and retention

- **Copy of their data:** guest's page, Privacy, Download. Read it before sending, as it includes private notes. Send it securely. Yorgos answers within a month.
- **Erasure:** guest's page, Privacy. Refused while a stay is current or to come, and while money is open: a pending or disputed payment, a pending refund, or a succeeded payment with no issued document. Issue the document or settle it, then try again. Retention skips such a guest and tries again the next day.
- **What stays:** invoices, invoice lines and their PDFs, because tax rules require them. Dates, amounts, statuses and references stay on the booking for the books, with no name attached.
- **What it does not reach:** Stripe, Resend, Airbnb, Booking.com, Google Workspace mail, and backups. Handle a request there separately: Stripe keeps its own customer and payment records.
- **How a person is found:** by id, an exact email, or a phone number of at least 8 digits. Never by name: a guest called Mark must not match the word "marketing". Same-name records appear on the guest's page as candidates, left out of the file unless asked for, and never removed by themselves. Open one to deal with it.
- **Free text is not searched:** a name in a note, a message from someone else, a host alert about a sync conflict, or a block note stays until retention removes that row. Block notes say "No guest names here" for this reason.
- **Retention:** `apply_retention` runs daily. The period is `settings.retention`, `{"years": 5}` (D27), still to confirm with the accountant, question 15. To change it: `update settings set value = '{"years": 7}' where key = 'retention';`. Allowed values are 1 to 30, and anything else stops the job rather than erasing.
- **Preview what it would do:** `select public.apply_retention();`. A dry run is the default. The job itself passes `false`.
- **`consent_log` is never purged:** no retention policy covers it yet. Rows hold a booking, message or anonymous browser id, not contact details. Decide with the legal review, then add it.

## Clear staging before launch

Production is a separate, empty project, so nothing moves across: staging data never reaches production. "Clearing" staging is about removing guest-like test data and tokens that are no longer needed. Staging data is all test data, except Yorgos's trial edits, which are also not copied.

Do not run any of this on production. Check twice.

1. `supabase projects list`: the linked project must be staging. Link it if not: `supabase link --project-ref <staging-ref>`.
2. Note anything worth keeping from staging, such as text Yorgos wrote in Text and photos. It has to be re-entered or imported in production.
3. Reset, which removes every row, including issued test invoices that the app itself cannot delete:

   ```bash
   supabase db reset --linked
   ```

4. Delete test PDFs from the `invoices` bucket and test uploads from `uploads-private` in Storage.
5. Re-run the imports (README), recreate the first Owner, and check the Vault secrets are still there.
6. In Stripe test mode, remove test customers if you want a clean view. Test data never reaches live mode.
7. Confirm `https://<staging host>/en` still has `noindex`.

Not yet rehearsed. `db reset --linked` asks for confirmation; read the project name it shows.

## Monitoring

- `/api/health` returns `{"status":"ok"}`. Point an uptime monitor at it and at `/en` (PLT-06, not yet set up).
- Logs are JSON lines in Vercel, with an `event` name and no personal data. Filter on `"level":"error"`.
- Sentry is optional: set `SENTRY_DSN` to an EU project. It receives the event name and error type only, with no message or stack. The app accepts only `*.ingest.de.sentry.io`.
