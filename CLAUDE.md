# MarkOS — working notes

An open-source, local-only AI executive team (marketing team underneath) for a founder's
portfolio. Single user, no login, not deployed.
See README.md for what it does and how it runs.

## Ground rules

- **Local only, no auth.** Server code uses `db()` from `lib/db.ts` (service key, no
  cookies). The browser never talks to the database: live updates poll `/api/pulse`
  (`lib/utils/use-poll.ts`, visible tab only). Never add login, RLS or
  `user_id` back.
- **All AI calls go through `lib/llm`** (`generateText`, `generateObject`,
  `researchThenShape`). They carry the run's AbortSignal, budget and accounting. Never
  call a provider SDK directly and never `JSON.parse` model text.
- **Claude Code is the default provider** (`lib/llm/providers/claude-code.ts`). It runs
  `claude -p` in safe mode, in its own working folder, with only the tools a call needs
  (web for research, read-only file tools for `readPaths`). It never gets write or
  shell tools. `ANTHROPIC_API_KEY` is stripped from its environment, because otherwise
  it bills the API instead of the plan.
- **Execs state facts from code, not memory.** Facts come from `lib/engine/execs/facts.ts`
  (git, the database). Reports and tasks are sanitised after the model replies: no
  number without a basis, no citation that isn't a retrieved page or a readable file, no
  contact that wasn't in what the web tools returned.
- **Public actions are the founder's.** Approving a post is consent to publish it at its
  time. Emails and pitches go out only on a click, to a confirmed address. Execs hand off
  work one hop at most.
- **Shapes are defined once** in `lib/engine/schemas.ts`. Agents, storage and pages all
  use the same zod schema — change it there, not in three places.
- **Sourced or labelled.** Web facts must pass `verifySources` against sources the search
  actually returned; contacts must appear in retrieved text (`keepFoundContacts`). Never
  let a model's claim that something is "real" stand without that check.
- **Never let a write fail silently.** Engine writes throw on error (`lib/engine/store.ts`);
  a failed step is a failed step. Warnings on the run describe the *final* state.
- **Never fabricate data the app presents as real.** Unknown numbers are null and the UI
  says so. PULSE uses only real activity plus numbers the founder enters.
- **The founder's work wins.** Re-runs supersede only untouched drafts; edited/approved
  items are kept; every change is versioned (`item_versions`).
- **Anything that costs money or changes work from LYRA is proposed, then confirmed.**
- **Schema changes are new migration files** in `supabase/migrations/`. The start script and
  `scripts/setup-db.sh` apply pending ones. Run `supabase` only with `MARKOS_JWT_SECRET` set
  (source `scripts/lib-start.sh`): without it the database comes up on keys that match nothing.
  `anon` and `authenticated` get no grants; the server uses service_role only. Every new table
  gets `alter table ... enable row level security;` in its migration (a test checks).
- **Two database modes.** New installs run Postgres + PostgREST directly via
  `scripts/native-db.mjs` (`MARKOS_DB=native` in `.env.local`; no `/rest/v1` prefix:
  `lib/db.ts` strips it). Older installs may still run Docker (Supabase). Tests follow `.env.local`'s mode. Run the suite in both modes
  before changing anything database-shaped: `MARKOS_DB=native node node_modules/vitest/vitest.mjs run`.

## Gotchas

- On an Apple Silicon Mac whose Homebrew Node is x86_64 (Rosetta), put an arm64 Node first
  on PATH and invoke `node node_modules/next/dist/bin/next` directly (npm/npx shebangs can
  pick the x64 node).
- Docker is **Colima**, not Docker Desktop. The Supabase CLI needs
  `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`. `[analytics]` is disabled in
  `supabase/config.toml` because Vector can't mount Colima's socket.
- After Colima restarts, `supabase start` reports "already running" and exits 1 while the
  containers come back — judge readiness by polling, not by that exit code.
- Dev server is **port 3001**; social OAuth redirects depend on `localhost:3001`.
- Gemini thinks by default and that counts against `maxOutputTokens`; the provider sets
  thinking explicitly. Grounding (google_search) and a JSON schema are separate calls.
- Model ids are config (`lib/llm/models.ts`); Settings → Test AI connection checks they
  still exist, and that Claude Code is installed and signed in.
- Every exec code path calls `applyModelSettings()` first. Without it, Settings'
  per-agent model choices are ignored.
- The night shift runs **inside the Next server**: `scripts/night-shift.sh` starts it
  headless and POSTs `/api/night`. Don't run engine code in a second process. Jobs are
  in-process (`lib/utils/jobs.ts`), and `/api/health` reports them so nothing stops
  mid-work.
- The dev server's PostCSS worker can pick up the x86 node and fail on lightningcss. To
  check the UI, preview the production build (`markos-app` in `.claude/launch.json`).
- Tests that stub `fetch` must match on the **host** and pass everything else through
  to the real fetch. The database client uses fetch too, and its query strings can
  contain the stubbed text.
- The founder's own to-dos are `tasks` rows with `exec = 'founder'`. They are tracked,
  never executed: keep `.neq('exec', 'founder')` wherever tasks get run.

@AGENTS.md
- Never import a **value** (object, function) from a `'use client'` file into a server
  component. It arrives as a client reference, so lookups are `undefined` and calls
  throw. Shared constants live in plain modules (e.g. `lib/engine/execs/people.ts`,
  `lib/utils/when.ts`).
- Colours are theme tokens (`bg-mk-bg`, `text-mk-text`, `border-mk-line`,
  `text-mk-accent-soft`, `text-mk-ok/warn/bad`, …), defined for light and dark in
  `app/globals.css`. Never hard-code hex colours in class names.
- Every chain of command lives in `lib/engine/charter.ts`. Any new agent prompt must
  include it, or go through `systemFor`. A test enforces this.
- Agents post to the team room (`post()` in `lib/engine/execs/team-room.ts`) only for
  real events. Tests must delete the `team_messages`, `meetings` and `tasks` they create.
- Data goes to iCloud Drive (or Application Support) via `scripts/backup-data.sh` after
  each night shift. Restores load as `supabase_admin`
  with `session_replication_role = replica` (`postgres` isn't a full superuser).
- The Data team reads product databases through `lib/engine/execs/data.ts` only. That
  means `checkQuery`, then a READ ONLY transaction with a timeout and a row cap.
  Connection strings are `DATA_URL_<PRODUCT>` in `.env.local`. A metric's value must
  appear in the query results (`data-team.ts`), or it is blanked.
- Work limits: each exec has at most `WIP_LIMIT` (3) open tasks from itself or
  teammates. Myra only gets meeting work (`isMeetingRequest`) and books at most one
  decision meeting a day. Every agent sees its teammates' abilities and the things
  nobody can do (run code, touch production, send anything public).
- LYRA is retired from the UI (the Team room replaced it); `lib/engine/assistant.ts`
  remains but nothing links to it.
- **Tests run against a separate test database** (`test-db/`, ports 563xx, started by
  `scripts/test-db.sh`, migrations symlinked), never the founder's live data.
  `tests/setup-env.ts` refuses to run against anything else. It forces the fake AI with
  `MARKOS_FORCE_MODEL` and turns the calendar off. No test writes `profiles`, and a test
  enforces that. A test night uses `startNight(..., { onlyProducts })`. (History: the
  shared-database era deleted real portfolio tasks and ran a real task with the fake AI.)
- After rebuilding, the running server must be restarted. `ensure_server` does it
  automatically by comparing `/api/health`'s `build` with `.next/BUILD_ID`, and never
  while work is running.
