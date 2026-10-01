#!/usr/bin/env bash
# Step 1: create the full schema (tables, RLS, views, functions, storage buckets) on the TARGET
# project by applying supabase/migrations in order. Safe to re-run: already-applied versions
# are skipped because the CLI records them in supabase_migrations.schema_migrations.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
need TARGET_DB_URL

log "Applying supabase/migrations to target"
cd "$REPO_ROOT"
yes | npx --yes supabase@latest db push --db-url "$TARGET_DB_URL" --include-all

log "Schema applied. Tables on target:"
psql "$TARGET_DB_URL" -At -c "select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname='public';"
