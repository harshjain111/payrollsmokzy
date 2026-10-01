#!/usr/bin/env bash
# Step 2: copy ALL rows from SOURCE to TARGET.
#   - public.*        every application table (ledgers, staff, attendance, expenses, ...)
#   - auth.users      login accounts INCLUDING password hashes, so nobody has to reset
#   - auth.identities provider links (email/phone identities)
# Storage *files* are copied by 03-copy-storage.mjs; storage.objects rows are created by that upload.
#
# The target's public tables are TRUNCATED first so this is idempotent. Only run against an
# empty/new target. Requires pg_dump + psql (PostgreSQL 15+ client).
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
need SOURCE_DB_URL TARGET_DB_URL

PUBLIC_DUMP="$WORK_DIR/public-data.sql"
AUTH_DUMP="$WORK_DIR/auth-data.sql"

log "Dumping public schema data from source"
pg_dump "$SOURCE_DB_URL" \
  --data-only --schema=public \
  --no-owner --no-privileges --disable-triggers \
  -f "$PUBLIC_DUMP"

log "Dumping auth users + identities from source"
pg_dump "$SOURCE_DB_URL" \
  --data-only \
  --table=auth.users --table=auth.identities \
  --no-owner --no-privileges --disable-triggers \
  -f "$AUTH_DUMP"

log "Source row counts"
psql "$SOURCE_DB_URL" -At -F' ' -c "
  select 'auth.users', count(*) from auth.users
  union all select 'auth.identities', count(*) from auth.identities;"

log "Truncating target public tables (fresh start) and clearing auth users"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
do $$
declare t text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into t from pg_tables where schemaname = 'public';
  if t is not null then
    execute 'truncate table ' || t || ' restart identity cascade';
  end if;
end $$;
delete from auth.identities;
delete from auth.users;
SQL

log "Restoring auth users + identities into target"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f "$AUTH_DUMP"

log "Restoring public data into target"
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f "$PUBLIC_DUMP"

log "Done. Run 04-verify.sh to compare row counts."
