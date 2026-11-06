# Casa Filakopi

Direct-booking platform for one farmhouse on Milos, sold as a whole house. Read `AGENTS.md` for Next.js version notes.

Read `docs/PLAN.md` first. It holds current status, decisions and tasks. Requirements with IDs are in `docs/requirements.md`.

## Stack

Next.js 16 App Router, TypeScript strict, pnpm, Node 24, Supabase, Stripe, Resend, next-intl, Vercel.

Node 24 is not the machine default. Prefix commands with:

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
```

## Commands

- `pnpm dev`: app on port 3000
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`: must pass before any merge
- `pnpm test:e2e`: Playwright smoke tests
- `pnpm baseline`: re-capture legacy screenshots
- `supabase start`, `supabase status`, `supabase db reset`: local database (needs Docker)

## Layout

- `app/[locale]`: public site (`/en`, `/el`)
- `app/admin`: admin panel, own root layout, not locale-prefixed
- `app/api`: route handlers
- `lib/domain`: business logic, no framework imports
- `lib/db`: Supabase clients
- `i18n`, `messages`: locale config and UI strings
- `emails`: email templates
- `supabase/migrations`: schema
- `legacy`: old static site, visual reference only, do not edit

Next 16 uses `proxy.ts`, not `middleware.ts`, and route `params` are Promises.

## Rules

- **Secrets:** never in the repo, the browser or chat. `lib/db/admin.ts` bypasses RLS and is server-only. Default to `lib/db/server.ts`.
- **Schema:** change only through migrations in `supabase/migrations`, never the dashboard. During parallel work only LEAD writes migrations.
- **Prices:** always computed on the server. Bookings confirm only from a verified Stripe webhook.
- **Overbooking:** every occupied date goes through `inventory_claims`.
- **Dates:** timestamps in UTC, business logic in Europe/Athens, stay dates as `date`.
- **Editable by Yorgos:** rules, prices, text and photos live in the database and Admin, not in code.
- **Mobile:** every public and admin page must work at 320 px with no overlap and no sideways scrolling.
- **Parallel work:** stay inside your track's folders listed in `docs/PLAN.md`.
- **Plan:** tick a task only after verifying it.
