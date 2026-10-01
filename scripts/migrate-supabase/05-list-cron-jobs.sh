#!/usr/bin/env bash
# Step 5 (optional): pg_cron schedules are NOT part of the migrations (they were created from
# the old project's dashboard). This prints them from SOURCE as ready-to-run cron.schedule()
# statements. Review the commands (they embed the OLD project URL and keys), swap in the new
# project URL / anon key, then run them against TARGET.
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
need SOURCE_DB_URL

psql "$SOURCE_DB_URL" -At -c "
select format('select cron.schedule(%L, %L, %L);', jobname, schedule, command)
from cron.job order by jobid;" 2>/dev/null || echo "-- pg_cron not enabled on source or no jobs."
