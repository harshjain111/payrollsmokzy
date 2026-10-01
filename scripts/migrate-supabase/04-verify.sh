#!/usr/bin/env bash
# Step 4: compare row counts for every public table, auth users and storage objects between
# SOURCE and TARGET. Any table whose counts differ is printed with a "<<< MISMATCH" marker.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
need SOURCE_DB_URL TARGET_DB_URL

COUNT_SQL=$(cat <<'SQL'
select t.schemaname || '.' || t.tablename as tbl,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.schemaname, t.tablename), false, true, '')))[1]::text::bigint as n
from pg_tables t
where t.schemaname = 'public'
union all select 'auth.users', count(*) from auth.users
union all select 'auth.identities', count(*) from auth.identities
union all select 'storage.objects', count(*) from storage.objects
order by 1;
SQL
)

psql "$SOURCE_DB_URL" -At -F'|' -c "$COUNT_SQL" | sort > "$WORK_DIR/counts-source.txt"
psql "$TARGET_DB_URL" -At -F'|' -c "$COUNT_SQL" | sort > "$WORK_DIR/counts-target.txt"

printf '%-40s %12s %12s\n' TABLE SOURCE TARGET
join -t'|' -a1 -a2 -e '?' -o '0,1.2,2.2' "$WORK_DIR/counts-source.txt" "$WORK_DIR/counts-target.txt" \
| while IFS='|' read -r tbl s t; do
    mark=""; [[ "$s" != "$t" ]] && mark="  <<< MISMATCH"
    printf '%-40s %12s %12s%s\n' "$tbl" "$s" "$t" "$mark"
  done
