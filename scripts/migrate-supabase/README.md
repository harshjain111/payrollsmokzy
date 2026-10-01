# Migrating from the Lovable-managed Supabase project

Moves everything from the old project (`xshnuzoqeoqwarvmsgef`, hosted by Lovable Cloud) into
the new project you own (`jotpsrmsauypyycdkbhp`). Run the steps in order from the repo root.

## Prerequisites

- PostgreSQL 15+ client tools (`psql`, `pg_dump`) on your PATH
- Node 20+ and `npm i` already run in the repo (the storage step uses `@supabase/supabase-js`)
- Credentials, in `scripts/migrate-supabase/.env.migration` (copy `.env.migration.example`):

| Variable | Where to find it |
| --- | --- |
| `SOURCE_DB_URL` | Old project's Postgres connection string (Lovable → project → Cloud/Backend settings) |
| `SOURCE_SUPABASE_URL`, `SOURCE_SERVICE_ROLE_KEY` | Old project's API URL and **service_role** key |
| `TARGET_DB_URL` | New project → Project Settings → Database → Connection string |
| `TARGET_SUPABASE_URL`, `TARGET_SERVICE_ROLE_KEY` | New project → Project Settings → API |

Notes on the connection strings:

- Percent-encode special characters in the password (`$` → `%24`, `@` → `%40`, `#` → `%23`).
- `db.<ref>.supabase.co:5432` resolves to IPv6 only. From an IPv4-only network use the
  **session pooler** shown in the dashboard instead:
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

## Steps

```sh
./scripts/migrate-supabase/01-apply-schema.sh     # tables, RLS, views, functions, buckets on TARGET
./scripts/migrate-supabase/02-copy-data.sh        # all public rows + auth users (password hashes kept)
node ./scripts/migrate-supabase/03-copy-storage.mjs  # attendance photos, expense proofs
./scripts/migrate-supabase/04-verify.sh           # row-count comparison, flags mismatches
./scripts/migrate-supabase/05-list-cron-jobs.sh   # prints pg_cron schedules to recreate (optional)
```

Step 2 truncates the target's public tables first, so the whole sequence can be re-run safely
on the new project until the counts in step 4 match.

## After the data is across

1. **Edge Functions**: `supabase login`, `supabase link --project-ref jotpsrmsauypyycdkbhp`,
   `supabase functions deploy`, then `supabase secrets set ...` (see the main README for the list).
2. **Auth settings** (Dashboard → Authentication): re-enable the sign-in methods the old project
   used. If staff log in by phone number, configure the same SMS provider. Set Site URL and
   Redirect URLs to the Vercel domain.
3. **Cron jobs**: run the `cron.schedule(...)` statements from step 5 against the new project after
   replacing the old project URL / anon key inside each command.
4. **App config**: `.env`, `supabase/config.toml` and the Vercel environment variables already
   point at the new project on this branch.
5. Log in once as the owner and spot-check a ledger, an attendance photo and a report.
