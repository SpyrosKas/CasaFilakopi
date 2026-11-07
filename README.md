# Casa Filakopi

Booking platform for Casa Filakopi, a farmhouse on Milos. The previous static site is in `legacy/` until cutover.

Plan and status: [docs/PLAN.md](docs/PLAN.md). Requirements: [docs/requirements.md](docs/requirements.md).

## Loading content and photos

Public pages read text and photos from Supabase, so **run both imports before the first deploy to any environment**, content first, then photos. A build with an empty database still succeeds, but the site then points at photos that are not in the bucket yet.

Local: `pnpm migrate:content`, then `pnpm migrate:media`.

Staging, from a checkout, with the secret key in your shell and never in a file:

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
export SUPABASE_SECRET_KEY=<secret key>
pnpm migrate:content --staging=<staging-ref>
pnpm migrate:media --staging=<staging-ref>
unset SUPABASE_SECRET_KEY
```

Production (T7.2) is the same with `--production=<production-ref>`. The flag must name the project in `NEXT_PUBLIC_SUPABASE_URL`, and both values must come from the shell.

Both imports are safe to repeat: they add what is missing and never change what Yorgos has edited.
