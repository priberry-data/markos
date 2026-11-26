-- Turn on Row Level Security for every table, with no policies.
-- MarkOS reaches the database only with the service_role key, which skips RLS, so the app is unchanged.
-- If the public (anon) key ever regains access, it sees no rows instead of every row.
-- Every new table needs the same line.
alter table public.agent_messages enable row level security;
alter table public.agent_outputs enable row level security;
alter table public.agent_reviews enable row level security;
alter table public.agent_runs enable row level security;
alter table public.ambassadors enable row level security;
alter table public.analytics_reports enable row level security;
alter table public.approvals enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.campaigns enable row level security;
alter table public.community_groups enable row level security;
alter table public.content_items enable row level security;
alter table public.customer_notes enable row level security;
alter table public.customers enable row level security;
alter table public.directives enable row level security;
alter table public.exec_reports enable row level security;
alter table public.generated_images enable row level security;
alter table public.goals enable row level security;
alter table public.house_rules enable row level security;
alter table public.issues enable row level security;
alter table public.item_versions enable row level security;
alter table public.llm_calls enable row level security;
alter table public.meeting_messages enable row level security;
alter table public.meetings enable row level security;
alter table public.metric_entries enable row level security;
alter table public.nights enable row level security;
alter table public.notifications enable row level security;
alter table public.outreach_targets enable row level security;
alter table public.pipeline enable row level security;
alter table public.product_brains enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.qa_checks enable row level security;
alter table public.run_steps enable row level security;
alter table public.seo_data enable row level security;
alter table public.social_tokens enable row level security;
alter table public.sources enable row level security;
alter table public.strategies enable row level security;
alter table public.tasks enable row level security;
alter table public.team_messages enable row level security;
