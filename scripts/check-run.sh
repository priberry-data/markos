#!/usr/bin/env bash
# Show what the last agent run actually wrote to the database.
# Usage: ./scripts/check-run.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

psql "$DB" -X -q <<'SQL'
\echo '── Latest run ─────────────────────────────────────────────'
select id, run_type, status, progress_percent as pct, current_phase,
       coalesce(jsonb_array_length(warnings), 0) as warnings,
       round(extract(epoch from (coalesce(completed_at, now()) - started_at))) as secs
from agent_runs order by started_at desc limit 1;

\echo ''
\echo '── Warnings on that run (should be empty) ─────────────────'
select jsonb_array_elements_text(warnings) as warning
from agent_runs order by started_at desc limit 1;

\echo ''
\echo '── Rows written per table ─────────────────────────────────'
select 'agent_outputs'    as table_name, count(*) from agent_outputs
union all select 'approvals',        count(*) from approvals
union all select 'strategies',       count(*) from strategies
union all select 'content_items',    count(*) from content_items
union all select 'outreach_targets', count(*) from outreach_targets
union all select 'campaigns',        count(*) from campaigns
union all select 'seo_data',         count(*) from seo_data
union all select 'community_groups', count(*) from community_groups
union all select 'ambassadors',      count(*) from ambassadors
union all select 'generated_images', count(*) from generated_images
union all select 'analytics_reports',count(*) from analytics_reports
union all select 'notifications',    count(*) from notifications
order by table_name;

\echo ''
\echo '── Which agents produced output ───────────────────────────'
select agent_name, output_type, created_at::time(0) as at
from agent_outputs order by created_at;
SQL
