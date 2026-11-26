-- MarkOS schema — consolidated, local-first, single user.
--
-- MarkOS runs only on its owner's Mac, so there is no login and no row-level
-- security: the app talks to the database with the service key from the server
-- (lib/db.ts), and the browser uses the anon key only for realtime updates.
--
-- Replaces the original 001-004 migration chain. That chain had type mismatches
-- between what the agents emit and what the tables accepted (community_groups
-- .member_count, seo_data.search_volume/difficulty, a missing ambassadors.platform),
-- which made several persistence steps fail silently. Column types here match what
-- the agents actually produce.

create extension if not exists "uuid-ossp";

-- ── Profiles ────────────────────────────────────────────────────────────────
-- One row, always id = 1: the owner's settings.
create table profiles (
  id int primary key default 1 check (id = 1),
  name text,
  -- address outreach email is sent from (must be verified in Resend)
  sender_email text,
  role text,
  company text,
  goals text[],
  -- which product the dashboard is currently showing
  active_product_id uuid,
  -- per-agent model overrides, e.g. {"strategy": "anthropic:claude-opus-5"}
  agent_models jsonb default '{}',
  -- the most a single agent run may spend on AI calls, in USD
  run_budget_usd numeric not null default 1.00,
  -- the most one night shift may use, as API-equivalent value (on a Claude
  -- plan nothing is billed per call; this caps how much of the plan it uses)
  night_budget_usd numeric not null default 20.00,
  -- the founder's working day, for the Executive Assistant's scheduling
  work_start text not null default '10:00',
  work_end text not null default '19:00',
  -- when meetings may be booked, e.g. '11:00-13:00,16:00-18:00'; outside them is focus time
  meeting_windows text not null default '11:00-13:00,16:00-18:00',
  max_meetings_per_day integer not null default 3,
  created_at timestamptz default now()
);

-- ── Products ────────────────────────────────────────────────────────────────
create table products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  url text not null,
  description text,
  category text,
  stage text,
  target_audience text,
  target_geography text,
  monthly_budget text,
  goals text[],
  competitors text,
  already_tried text,
  brand_voice text,
  logo_url text,
  primary_color text,
  secondary_color text,
  -- ISO currency for budgets and ads, e.g. INR; derived from geography if unset
  currency text,
  -- monthly paid-ads budget; 0 means no paid ads (MAX is skipped)
  ad_budget_monthly numeric not null default 0,
  launch_date date,
  -- IVY (fundraising) runs only when raising; VERA (PR) only when announcing
  raising boolean not null default false,
  announcing_launch boolean not null default false,
  -- Local folders the executive team may read (never write): the product's
  -- repo, docs, assets. Empty when there is no code on this Mac.
  repo_paths text[] not null default '{}',
  -- An offering inside another product (a plan inside an app), or a unit of a
  -- family (one lab inside a group).
  parent_id uuid references products(id) on delete set null,
  -- What the intake agent read from the repo, waiting for the founder to
  -- confirm: none | draft | confirmed. Conflicts are listed, never guessed.
  intake_status text not null default 'none',
  intake jsonb,
  -- Whether the night shift works on this product at all.
  night_enabled boolean not null default true,
  -- When the CMO's team last did a deep pass, so products take turns.
  last_deep_night timestamptz,
  status text default 'active',
  created_at timestamptz default now()
);

alter table profiles
  add constraint profiles_active_product_fk
  foreign key (active_product_id) references products(id) on delete set null;

-- ── Agent runs ──────────────────────────────────────────────────────────────
create table agent_runs (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  run_type text not null,
  status text default 'pending',
  progress_percent integer default 0,
  -- the phase actually executing, written by the orchestrator. The UI used to
  -- guess this from the progress percentage.
  current_phase text,
  -- non-fatal problems (e.g. a persistence step that wrote nothing). A run with
  -- warnings must not be reported as a clean success.
  warnings jsonb default '[]',
  started_at timestamptz default now(),
  completed_at timestamptz,
  updated_at timestamptz default now(),
  error_message text,
  metadata jsonb default '{}',
  -- research | strategy | awaiting_approval | production | review | finalize
  phase text
);

-- ── Agent outputs ───────────────────────────────────────────────────────────
create table agent_outputs (
  id uuid primary key default uuid_generate_v4(),
  -- nullable: ad-hoc agents (ZEUS, LYRA) produce output outside a run
  run_id uuid references agent_runs(id) on delete cascade,
  product_id uuid references products(id) on delete cascade not null,
  agent_name text not null,
  output_type text not null,
  content_json jsonb not null default '{}',
  status text default 'completed',
  -- re-running an agent adds a new version and supersedes the old one
  version integer not null default 1,
  -- web pages this output was grounded in: [{title, url}]
  sources jsonb not null default '[]',
  created_at timestamptz default now()
);

-- ── Approval queue ──────────────────────────────────────────────────────────
create table approvals (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  agent_name text not null,
  output_type text not null,
  title text not null,
  preview_text text,
  full_content_json jsonb not null default '{}',
  status text default 'pending',
  approved_at timestamptz,
  rejected_at timestamptz,
  reviewed_at timestamptz,
  edited_content jsonb,
  created_at timestamptz default now()
);

-- ── Content calendar ────────────────────────────────────────────────────────
create table content_items (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  platform text not null,
  content_type text,
  title text,
  body text,
  media_urls text[],
  hashtags text[],
  scheduled_at timestamptz,
  status text default 'draft',
  approval_id uuid references approvals(id),
  published_at timestamptz,
  performance_json jsonb default '{}',
  hook text,
  cta text,
  goal text,
  visual_idea text,
  -- the NOVA output this piece came from; re-running supersedes unedited drafts
  output_id uuid references agent_outputs(id) on delete set null,
  -- the founder changed it, so re-runs never touch it
  edited boolean not null default false,
  rejected_reason text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Outreach pipeline ───────────────────────────────────────────────────────
create table outreach_targets (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  type text not null,
  name text not null,
  platform text,
  handle_or_email text,
  follower_count integer,
  relevance_score integer default 0,
  status text default 'identified',
  outreach_draft text,
  follow_up_draft text,
  personalization_notes text,
  why_good_fit text,
  persona text,
  tier text,
  url text,
  audience_size text,
  -- the retrieved page this target was found on; null means unverified
  source text,
  verified boolean not null default false,
  approach text,
  draft_subject text,
  output_id uuid references agent_outputs(id) on delete set null,
  rejected_reason text,
  -- outreach only ever goes to an address the founder confirmed
  contact_confirmed boolean not null default false,
  sent_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Ad campaigns (drafts only — nothing is pushed to an ad platform) ─────────
create table campaigns (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  platform text not null,
  campaign_type text,
  objective text,
  budget numeric,
  targeting_json jsonb default '{}',
  ad_copies_json jsonb default '{}',
  status text default 'draft',
  performance_json jsonb default '{}',
  created_at timestamptz default now()
);

-- ── Strategy documents ──────────────────────────────────────────────────────
create table strategies (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  version integer default 1,
  positioning text,
  icp_json jsonb default '{}',
  channel_priorities_json jsonb default '{}',
  ninety_day_plan_json jsonb default '{}',
  brand_voice_doc text,
  messaging_hierarchy jsonb default '{}',
  created_at timestamptz default now()
);

-- ── Analytics reports ───────────────────────────────────────────────────────
create table analytics_reports (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  period_start timestamptz,
  period_end timestamptz,
  metrics_json jsonb default '{}',
  insights_json jsonb default '{}',
  recommendations_json jsonb default '{}',
  -- 'estimated' until a real analytics source is connected. The UI must say so.
  data_source text not null default 'estimated',
  created_at timestamptz default now()
);

-- ── Ambassadors ─────────────────────────────────────────────────────────────
create table ambassadors (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  name text not null,
  -- the orchestrator writes this; it existed in no previous migration, so every
  -- ambassador insert failed
  platform text,
  handle_or_email text,
  follower_count integer,
  content_type text,
  audience_overlap_score integer,
  compensation_model text,
  outreach_template text,
  notes text,
  status text default 'prospect',
  content_json jsonb default '{}',
  created_at timestamptz default now()
);

-- ── Community groups ────────────────────────────────────────────────────────
create table community_groups (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  platform text not null,
  name text not null,
  url text,
  -- text, not integer: the agent emits values like "2.4M members"
  member_count text,
  description text,
  fit_score integer,
  engagement_score integer,
  status text default 'identified',
  notes text,
  content_json jsonb default '{}',
  created_at timestamptz default now()
);

-- ── SEO data ────────────────────────────────────────────────────────────────
create table seo_data (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  keyword text not null,
  -- text, not integer: the agent emits ranges like "1K-10K/month" and
  -- difficulty as 'low' | 'medium' | 'high'
  search_volume text,
  difficulty text,
  current_rank integer,
  target_rank integer,
  content_url text,
  theme text,
  intent text,
  source text,
  status text not null default 'current',
  output_id uuid references agent_outputs(id) on delete set null,
  created_at timestamptz default now()
);

-- ── Notifications ───────────────────────────────────────────────────────────
create table notifications (
  id uuid primary key default uuid_generate_v4(),
  -- null for app-wide notices; set when the notice is about one product
  product_id uuid references products(id) on delete cascade,
  type text not null,
  title text not null,
  message text,
  read boolean default false,
  action_url text,
  created_at timestamptz default now()
);

-- ── Social OAuth tokens ─────────────────────────────────────────────────────
create table social_tokens (
  id uuid primary key default uuid_generate_v4(),
  platform text not null unique,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  username text,
  platform_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function update_social_tokens_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger social_tokens_updated_at
  before update on social_tokens
  for each row execute procedure update_social_tokens_updated_at();

-- ── Agent message bus ───────────────────────────────────────────────────────
create table agent_messages (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  thread_id uuid not null default uuid_generate_v4(),
  from_agent text not null,
  to_agent text not null,
  message_type text not null default 'request',
  subject text,
  content jsonb not null,
  status text not null default 'pending',
  parent_id uuid references agent_messages(id),
  response_content jsonb,
  responded_at timestamptz,
  created_at timestamptz default now()
);

-- ── Generated images (Replicate / FLUX) ─────────────────────────────────────
create table generated_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  agent_name text not null default 'pixel',
  title text,
  content_type text,
  platform text,
  prompt text not null,
  negative_prompt text,
  model text not null default 'flux-1.1-pro',
  image_url text,
  width integer default 1024,
  height integer default 1024,
  status text not null default 'pending',
  error_message text,
  design_brief text,
  copy_direction text,
  created_at timestamptz default now()
);

-- ── Product brain ───────────────────────────────────────────────────────────
-- The one canonical context every agent receives: the latest research, the
-- strategy (draft until the founder approves it), and learned house rules.
create table product_brains (
  product_id uuid primary key references products(id) on delete cascade,
  research jsonb,
  research_output_id uuid references agent_outputs(id) on delete set null,
  strategy jsonb,
  strategy_output_id uuid references agent_outputs(id) on delete set null,
  strategy_status text not null default 'none',   -- none | draft | approved
  strategy_approved_at timestamptz,
  updated_at timestamptz default now()
);

-- Every web page an agent actually retrieved. A citation elsewhere in MarkOS is
-- only kept if it points at one of these.
create table sources (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  url text not null,
  title text,
  agent text not null,
  run_id uuid references agent_runs(id) on delete set null,
  retrieved_at timestamptz default now(),
  unique (product_id, url)
);

-- Preferences learned from the founder's rejections and edits, injected into
-- every agent's context.
create table house_rules (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  rule text not null,
  origin text not null default 'manual',          -- manual | rejection | edit
  active boolean not null default true,
  created_at timestamptz default now()
);

-- One row per agent per run, so parallel agents never overwrite each other's
-- status (the old single current_phase column did).
create table run_steps (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid references agent_runs(id) on delete cascade not null,
  -- lets the UI listen to one product's steps instead of every step
  product_id uuid references products(id) on delete cascade,
  agent text not null,
  status text not null default 'queued',          -- queued | running | done | failed | skipped
  detail text,
  output_id uuid references agent_outputs(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, agent)
);
create index idx_run_steps_run on run_steps(run_id);
create index idx_run_steps_product on run_steps(product_id);
create index idx_sources_product on sources(product_id);
create index idx_house_rules_product on house_rules(product_id) where active;


-- ARIA's review of each agent's work in a run, and whether it was revised.
create table agent_reviews (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid references agent_runs(id) on delete cascade,
  product_id uuid references products(id) on delete cascade not null,
  agent text not null,
  verdict text not null,            -- pass | revise
  issues jsonb not null default '[]',
  revised boolean not null default false,
  revision_error text,
  created_at timestamptz default now()
);
create index idx_agent_reviews_run on agent_reviews(run_id);

-- Every change to a content piece or outreach draft keeps the previous version.
create table item_versions (
  id uuid primary key default uuid_generate_v4(),
  item_table text not null,        -- content_items | outreach_targets
  item_id uuid not null,
  content jsonb not null,
  reason text,                     -- edited | refined: <instruction> | revised by ARIA
  created_at timestamptz default now()
);
create index idx_item_versions_item on item_versions(item_table, item_id, created_at desc);

-- LYRA's conversation, per product, kept across restarts.
create table assistant_messages (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  role text not null,               -- user | assistant
  content text not null,
  action jsonb,                     -- an action LYRA proposed, if any
  action_status text,               -- proposed | done | failed | dismissed
  created_at timestamptz default now()
);
create index idx_assistant_messages_product on assistant_messages(product_id, created_at);

-- Numbers only the founder knows (signups, traffic, revenue, followers),
-- entered on the Weekly review page. PULSE never invents these.
create table metric_entries (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  metric text not null,
  value numeric not null,
  note text,
  recorded_for date not null default current_date,
  created_at timestamptz default now()
);
create index idx_metric_entries_product on metric_entries(product_id, recorded_for desc);

-- ── AI call ledger ──────────────────────────────────────────────────────────
-- One row per model call: what it cost and whether it worked. Powers the cost
-- shown per run and per agent, and the per-run budget cap.
create table llm_calls (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid references agent_runs(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  agent text not null,
  purpose text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  grounded_requests integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms integer,
  status text not null,
  error text,
  created_at timestamptz default now()
);
create index idx_llm_calls_run on llm_calls(run_id);
create index idx_llm_calls_product on llm_calls(product_id, created_at desc);

-- ── The executive team ──────────────────────────────────────────────────────
-- One row per night shift. Holds the plan, a log of what ran, and the morning
-- brief the Chief of Staff writes from every exec's report.
create table nights (
  id uuid primary key default uuid_generate_v4(),
  status text not null default 'running',   -- running | completed | partial | failed | cancelled
  trigger text not null default 'schedule', -- schedule | manual
  plan jsonb not null default '[]',
  log jsonb not null default '[]',
  -- set when the Claude plan's usage limit stopped the shift
  paused_reason text,
  resume_after timestamptz,
  brief jsonb,
  -- the scoreboard behind the brief, counted by code (lib/engine/execs/analytics.ts)
  analytics jsonb,
  brief_read_at timestamptz,
  error_message text,
  started_at timestamptz default now(),
  finished_at timestamptz
);
create index idx_nights_started on nights(started_at desc);

-- Each exec's report: per product, or portfolio-wide when product_id is null.
create table exec_reports (
  id uuid primary key default uuid_generate_v4(),
  night_id uuid references nights(id) on delete cascade,
  exec text not null,
  product_id uuid references products(id) on delete cascade,
  report jsonb not null,
  sources jsonb not null default '[]',
  created_at timestamptz default now()
);
create index idx_exec_reports_night on exec_reports(night_id, exec);
create index idx_exec_reports_recent on exec_reports(exec, created_at desc);

-- An instruction from the founder, as written, and how the Chief of Staff
-- routed it. target_exec is set when it was written to one exec directly.
create table directives (
  id uuid primary key default uuid_generate_v4(),
  text text not null,
  target_exec text,
  routing jsonb,
  clarify text,
  status text not null default 'routing',   -- routing | routed | needs_clarity | failed
  error_message text,
  created_at timestamptz default now()
);
create index idx_directives_recent on directives(created_at desc);

-- One piece of work for one exec, from a directive or from another exec.
create table tasks (
  id uuid primary key default uuid_generate_v4(),
  directive_id uuid references directives(id) on delete cascade,
  exec text not null,
  product_id uuid references products(id) on delete cascade,
  task text not null,
  why text,
  priority text not null default 'normal',  -- high | normal | low
  due date,
  -- founder | an exec key, when one exec hands work to another
  origin text not null default 'founder',
  status text not null default 'queued',    -- queued | running | done | failed | cancelled
  result jsonb,
  result_summary text,
  sources jsonb not null default '[]',
  error_message text,
  night_id uuid references nights(id) on delete set null,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index idx_tasks_status on tasks(status, priority, created_at);
create index idx_tasks_exec on tasks(exec, created_at desc);

-- Sales and partnerships: companies, colleges, partners and programmes worth
-- approaching. A row's source is a page the search really returned.
create table pipeline (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  kind text not null,                       -- company | college | partner | community | candidate_source
  name text not null,
  website text,
  why_fit text,
  source text,
  verified boolean not null default false,
  -- a public contact, kept only if it appeared in a retrieved page
  contact text,
  contact_confirmed boolean not null default false,
  stage text not null default 'identified', -- identified | contacted | replied | meeting | won | lost | dropped
  next_step text,
  pitch_subject text,
  pitch_body text,
  notes text,
  last_contacted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (product_id, name)
);
create index idx_pipeline_product on pipeline(product_id, stage);

-- ── The founder's office ─────────────────────────────────────────────────────
-- Meetings the Executive Assistant books between the founder and the team.
create table meetings (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  kind text not null default 'decision',     -- decision | one_on_one | staff | review | customer
  execs text[] not null default '{}',
  product_id uuid references products(id) on delete set null,
  purpose text,
  agenda jsonb not null default '[]',        -- [{item, owner, decision_needed}]
  pre_read text,
  scheduled_at timestamptz not null,
  duration_min integer not null default 20,
  status text not null default 'scheduled',  -- scheduled | in_progress | done | cancelled | missed
  minutes jsonb,                             -- {summary, decisions[], action_items[]}
  -- the event in the founder's Mac Calendar, and why syncing failed if it did
  calendar_uid text,
  calendar_error text,
  created_by text not null default 'ea',
  night_id uuid references nights(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_meetings_when on meetings(scheduled_at);

create table meeting_messages (
  id uuid primary key default uuid_generate_v4(),
  meeting_id uuid references meetings(id) on delete cascade not null,
  speaker text not null,                     -- founder | an exec key | ea
  content text not null,
  created_at timestamptz default now()
);
create index idx_meeting_messages on meeting_messages(meeting_id, created_at);

-- Bugs, errors and quality problems, from QA's checks, the repos or customers.
create table issues (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  title text not null,
  severity text not null default 'medium',   -- low | medium | high | critical
  evidence text,
  area text,
  origin text not null default 'qa',         -- qa | monitor | customer | founder | an exec key
  status text not null default 'open',       -- open | fixed | wont_fix
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (product_id, title)
);
create index idx_issues_open on issues(product_id, status);

-- What QA's code checks saw on each product's live pages.
create table qa_checks (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  url text not null,
  status integer,
  ms integer,
  ok boolean not null,
  problem text,
  checked_at timestamptz default now()
);
create index idx_qa_checks_product on qa_checks(product_id, checked_at desc);

-- The people the Customer team talks to. An email is only ever one the founder entered.
create table customers (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  name text not null,
  email text,
  company text,
  segment text,                              -- e.g. power user, new, churned, design partner
  notes text,
  draft_subject text,
  draft_body text,
  draft_purpose text,
  last_contacted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_customers_product on customers(product_id);

-- Conversations the founder had or pasted in, and what the Customer team made of them.
create table customer_notes (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade not null,
  customer_id uuid references customers(id) on delete set null,
  content text not null,
  synthesis jsonb,
  created_at timestamptz default now()
);

-- ── Goals ───────────────────────────────────────────────────────────────────
-- What the company is working toward: one company goal and a few per
-- product, each with an owner, a number and a date. Every agent sees them;
-- the brief tracks them. Drafted from the products' own docs, but only the
-- founder makes a goal active.
create table goals (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade,   -- null = the whole company
  title text not null,
  metric text,                               -- what is counted, e.g. "design partners signed"
  current numeric,                           -- entered by the founder; null = not known yet
  target numeric,
  unit text,
  due date,
  owner text,                                -- the exec accountable
  why text,
  status text not null default 'proposed',   -- proposed | active | achieved | dropped
  source text not null default 'chief_of_staff',
  sort integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_goals_status on goals(status, sort);

-- ── The team room ───────────────────────────────────────────────────────────
-- One group conversation: the founder and every agent. Agents post here when
-- they hand work over, ask each other, take something on, finish it, report
-- or book a meeting — every message is tied to something that really happened.
create table team_messages (
  id uuid primary key default uuid_generate_v4(),
  speaker text not null,                     -- founder | chief_of_staff | an exec key
  to_seats text[] not null default '{}',     -- who it's addressed to; empty = everyone
  kind text not null default 'chat',         -- chat | handoff | question | answer | move | done | failed | report | meeting | issue | routing
  content text not null,
  product_id uuid references products(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  meeting_id uuid references meetings(id) on delete set null,
  reply_to uuid references team_messages(id) on delete set null,
  created_at timestamptz default now()
);
create index idx_team_messages_recent on team_messages(created_at desc);

-- ── Access ──────────────────────────────────────────────────────────────────
-- Single-user and local-only: no row-level security. The server uses the service
-- key; the browser's anon key is used only to receive realtime updates.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;

-- ── Indexes ─────────────────────────────────────────────────────────────────
create index idx_agent_runs_product       on agent_runs(product_id, started_at desc);
create index idx_agent_outputs_product    on agent_outputs(product_id, agent_name, created_at desc);
create index idx_approvals_product_status on approvals(product_id, status);
create index idx_content_items_product    on content_items(product_id, status);
create index idx_outreach_product_status  on outreach_targets(product_id, status);
create index idx_notifications_recent     on notifications(read, created_at desc);
create index idx_generated_images_product on generated_images(product_id, created_at desc);
create index idx_agent_messages_product   on agent_messages(product_id, created_at desc);

-- ── Realtime (live dashboard) ───────────────────────────────────────────────
-- Tolerate a publication that is already FOR ALL TABLES, or already has these.
do $$
begin
  begin alter publication supabase_realtime add table agent_runs; exception when others then null; end;
  begin alter publication supabase_realtime add table notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table run_steps; exception when others then null; end;
  begin alter publication supabase_realtime add table nights; exception when others then null; end;
  begin alter publication supabase_realtime add table tasks; exception when others then null; end;
  begin alter publication supabase_realtime add table meetings; exception when others then null; end;
  begin alter publication supabase_realtime add table meeting_messages; exception when others then null; end;
  begin alter publication supabase_realtime add table team_messages; exception when others then null; end;
end $$;

-- ── Owner settings row ──────────────────────────────────────────────────────
insert into profiles (id) values (1);
