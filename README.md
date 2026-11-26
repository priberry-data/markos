# MarkOS by Priberry

**[markos.priberry.com](https://markos.priberry.com)** · open source (Apache-2.0) · runs on your own computer: Mac, Windows or Linux

An executive team that runs on your own computer and works overnight. Every morning
you open it to a brief from your Chief of Staff, with reports from your CMO, CFO,
CPO, CTO, Sales and COO across every product you run. You write one instruction,
in any words, and the Chief of Staff sends each part to the exec who owns it.

Under the CMO sits a marketing team that researches the live web, drafts a strategy
**you approve**, writes your content, finds where your audience is, and reviews its
own work before you see it.

Single-user and local-only: no login, no cloud database, nothing deployed. The AI
runs on **your Claude plan through Claude Code**, with no API key and no per-call bill.

## What it is

An open-source AI executive team for founders. MarkOS's agents can search the web and read
the folders you point them at, and nothing else. They never write files or run commands, and
nothing is posted or sent without your click.

## Requirements

MarkOS runs on **Mac, Windows and Linux**. Every change is installed from scratch and tested
on all three by [CI](.github/workflows/ci.yml): Windows x64, Linux x64 and arm64, and macOS.
Each run installs, starts the server, checks its pages, backs up, schedules the night shift,
and runs the full test suite. It has been used day to day on a Mac. If a step fails on your
machine, please [open an issue](https://github.com/priberry-data/markos/issues).

- **Mac** (Apple silicon; Intel Macs should work but aren't in CI), **Windows 10 or 11** (x64), or **Linux** (x64 or arm64)
- Node 22 or newer (`node --version`), from [nodejs.org](https://nodejs.org) or your package manager
- Claude Code, signed in to your Claude plan. The agents run on your plan, so there's no per-call bill.
  - Mac or Linux: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
  - then run `claude` and type `/login`

That's all. No Docker. `node scripts/markos.mjs doctor` checks it before you start.

## Install

One line. It puts MarkOS in `~/markos` (git if you have it, otherwise a download from GitHub)
and runs the installer. Run it again to update.

**Mac or Linux**

```bash
curl -fsSL https://markos.priberry.com/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://markos.priberry.com/install.ps1 | iex
```

Read them first if you like: [install.sh](site/install.sh), [install.ps1](site/install.ps1).
Or clone and run the installer yourself:

```bash
git clone https://github.com/priberry-data/markos && cd markos && ./install.sh                                # Mac or Linux
git clone https://github.com/priberry-data/markos; cd markos; powershell -ExecutionPolicy Bypass -File install.ps1   # Windows
```

It checks your computer, installs, sets up the database and puts MarkOS on your Desktop: an
app on a Mac, a shortcut on Windows, a launcher (and an entry in your app menu) on Linux. Run it
again any time; it's safe.

Then open **MarkOS** from the Desktop, or run `node scripts/markos.mjs open`. It starts the
database if needed, builds when the code has changed, and opens on the morning brief in its own
window (Chrome or Edge; otherwise your default browser). Closing the window stops the server
once any work in progress finishes.

Everything else is one command too, the same on every system:

```bash
node scripts/markos.mjs start | stop      # the server and database, without a window
node scripts/markos.mjs night-shift       # run the night shift daily at 02:00 (add "remove" to undo)
node scripts/markos.mjs backup            # back up your data now
node scripts/markos.mjs restore <file>    # put a backup back
```

**Where MarkOS keeps its files**

| | Data | Logs |
|---|---|---|
| Mac | `~/Library/Application Support/MarkOS` | `~/Library/Logs/MarkOS` |
| Windows | `%LOCALAPPDATA%\MarkOS` | `%LOCALAPPDATA%\MarkOS\logs` |
| Linux | `~/.local/share/markos` | `~/.local/state/markos/logs` |

**Light on memory.** The database is Postgres 17 with PostgREST in front, running directly
on your computer: about 80 MB of memory when idle (measured on a Mac). The installer downloads
Postgres from npm (once) and PostgREST from its GitHub release, checked against its published
checksum, into the `runtime` folder above. Pages poll for updates every few seconds, and only
while the tab is visible.

**The database stays on your computer.** Both ports listen on 127.0.0.1 only. Each install
signs its keys with its own random secret (`jwt-secret` in the data folder), and a request
without the server's key gets nothing.

**Already on Docker? (Mac)** Earlier versions ran the database in Docker with Supabase, using a
2 GB VM. They keep working as they are. To move off Docker, run
`./scripts/setup-db.sh --native`: it copies every row across and leaves the Docker volume
untouched. To set up a new install on Docker anyway, use `./install.sh --docker`; it needs
`brew install colima docker supabase/tap/supabase`, caps the VM at 2 GB
(`MARKOS_VM_MEMORY`), runs only the Supabase services MarkOS uses, and binds them to this
Mac. Start a Docker database with the scripts, not a bare `supabase start`: without this
install's secret it comes up on keys that match nothing.

## First run

1. Settings → **Test AI connection** checks that Claude Code is signed in and that a live web
   search returns sources.
2. **Products**: add each product, point it at its repo folder, press *Read the product*, and
   confirm what the team read. Where the repo contradicts itself, both versions are listed and
   nothing is guessed.
3. **Night shift**: `node scripts/markos.mjs night-shift` runs it every day at 02:00 (launchd on a
   Mac, Task Scheduler on Windows, a systemd user timer or cron on Linux). A computer that was
   asleep or off at 02:00 runs it when it wakes.
4. Optional, in `.env.local`:
   - `RESEND_API_KEY` + `RESEND_FROM_EMAIL` to send outreach you approve
   - your own X / LinkedIn app keys, then connect them in Settings so approved posts go out on time
   - `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` to run particular agents on those APIs instead

## Finding your way

MarkOS has six places, in the sidebar:

| | What it answers |
|---|---|
| **Home** | Who's on my team and what are they doing? Your team as cards (working now, queued, latest report), what's waiting for you, one box to tell the team anything (typed or spoken), and the morning brief. Click anyone to open their desk. |
| **Goals** | What are we all working toward? One company goal and a few per product, each with an owner, a number and a date. Drafted from your docs; you confirm. Every agent reads them. |
| **Team room** | What are they saying? The group chat. @mention someone, or just talk. |
| **Inbox** | What's waiting for me? Every decision, approval, draft and to-do across all products, most important first. |
| **Calendar** | When am I meeting whom? The meetings Myra booked, and your action items. |
| **Products** | Everything about one product. Open its workspace for these tabs: To approve, Research, Strategy, Content, Distribution, Search & AI, Creative, Pipeline, Customers, Quality, Weekly review. |

At the bottom: **Team & roles** (who does what, the chain of command, the skills) and
**Settings**.

## How it keeps your machine safe

Each line is checked by a test you can run. For the agent rows, the tests check what MarkOS asks
Claude Code for (which tools, which deny rules) on every call; Claude Code's permission system
enforces them.

| Promise | Test |
|---|---|
| Agents get only the tools a step needs: web search, or read-only file tools. Never write, edit or shell tools. | `tests/llm/claude-code.test.ts` "gives each call only the tools it needs" |
| One call never gets both the web and your files, so a web page can't steer an agent into leaking a file. | `tests/llm/claude-code.test.ts` "never gives one call both the web and files" |
| File-reading calls are denied `.env*`, `*.pem` and SSH keys in every folder they may read. | `tests/llm/claude-code.test.ts` "denies reading secret files" |
| An `ANTHROPIC_API_KEY` in your environment never quietly moves billing off your plan. | `tests/llm/claude-code.test.ts` "never lets an API key switch billing" |
| The server answers only this computer. Other websites, and pages whose domain points at 127.0.0.1, can't change anything. Scripts need a local token. | `tests/utils/local-guard.test.ts` |
| The database gives nothing to a request with no key or the anon key, so a web page can't read it through 127.0.0.1. | `tests/engine/db-access.test.ts` |
| Every agent prompt carries the chain of command. | `tests/engine/team.test.ts` "no agent prompt in the engine is written without it" |

## Your data

Everything lives in a Postgres database on your computer. `node scripts/markos.mjs backup` writes
a compressed dump, and runs after every night shift: on a Mac to iCloud Drive → *MarkOS Backups*
when iCloud is on, otherwise to `backups` in the data folder (`MARKOS_BACKUP_DIR` to choose,
for example a synced Dropbox or OneDrive folder). It keeps the last 30. Restore with
`node scripts/markos.mjs restore <file>`. Secrets in `.env.local` and your X /
LinkedIn connections are never in git or the backups: keep the secrets in your password
manager, and reconnect the accounts after a restore.

The server listens only on 127.0.0.1. Changes through its API need either the MarkOS window
itself or the local token (`local-token` in the data folder), which is
created on first start and used by the night shift.

## The executive team

| Exec | Owns | Works from |
|---|---|---|
| **Chief of Staff** | Routes your instructions; writes the morning brief | Every report, every task |
| **CMO** | The marketing team below, rotating through products | The web, the approved strategy |
| **Data** | Real numbers straight from your product databases (read-only SQL), data quality | Each product's database, via a read-only login you create (Settings → Data connections) |
| **CFO** | Pricing, unit economics, runway | Pricing in your code and numbers you enter. Never invents revenue |
| **CPO** | What shipped; what to announce; where marketing over-promises | The repos (read-only) |
| **CTO** | Repo health: unfinished work, pending migrations, risks | The repos (read-only) |
| **Sales** | Design partners, customers, colleges, partners, each with a source; drafts pitches | The web, the pipeline |
| **COO** | What's due, stuck or waiting on you, across products | Tasks, approvals, reports |

Under them: **Platform** (reports to the CTO) inspects MarkOS itself: failed tasks,
AI errors, slow or costly steps. It proposes fixes and never changes anything itself.
**QA** (also under the CTO) checks your live pages every night, reads risky
changes, and files bugs as issues. The **Customer team** (reports to the COO) drafts
check-ins and interview invites to people you added. It also turns conversations you
paste in into bugs, feature asks and customer quotes, and sends each to whoever can act
on it.

**The team room** is one group chat with the whole team. Every hand-off, question,
answer, "I'm on it", "done", report and booked meeting shows up there as it happens.
You can write in it at any time:
- @mention someone to be sure they answer, or let the Chief of Staff pick.
- Each agent replies as itself, from its own skill, report and open work.
- An agent can take on work, hand it to a teammate, ask a teammate (who answers in the
  room) or ask Myra for a meeting.
- At most three answer you, and a teammate's answer never asks back, so it can't loop.

**Voice and live routing.** The command box on the brief and the team room take
dictation (Chrome speech, in eight languages: pick yours next to the mic). While you speak or type,
the team on the side lights up: instantly from what you say, then from what you mean.

**Light or dark.** MarkOS starts in light mode. The sun/moon button at the top right
switches, and your choice is remembered.

**Myra, your Executive Assistant**, books a meeting only when something needs you:
- She stays inside your meeting windows and under your daily limit (Settings → Your
  working day).
- Each meeting gets an agenda and a pre-read, and shows on MarkOS's Calendar page. On a Mac
  it also goes on your Mac Calendar in a "MarkOS" calendar (macOS asks once for permission);
  on Windows and Linux it stays in MarkOS.
- In the meeting room you talk to the execs. When you end the meeting, Myra writes the
  minutes, and every action item becomes a dated task. Yours show as your to-dos.
- She books at most one decision meeting a day (the five decisions that matter most),
  plus a weekly staff meeting early in the week. Everything else stays in your Inbox.

Every exec carries a **skill**: a playbook distilled, with credit, from the best
operators in its field. Its reports run that skill on **analytics the code
counts**, which compare this week with last and list what isn't happening. From that,
each exec proposes **moves**. See Team & skills.

**What runs on its own, and what waits for you.** Internal work runs without you:
research, plans, drafts, revisions, reports, and work one exec hands to another (one
hop only, never a chain). Anything public waits for your one-tap OK:
- approving a post is your OK to publish it at its scheduled time
- an email or pitch goes out only when you press Send, to an address you confirmed

**The night shift** reads any new product, works your queued instructions first,
gives two products (the longest-waiting) a full marketing and prospecting pass,
collects every exec's report, and then writes the brief. It fits a Claude plan:
- a nightly cap stops the shift cleanly
- if the plan's usage limit resets before morning, the shift waits for the reset and
  carries on
- otherwise it stops, and the brief says what didn't happen

## How a launch works

```
REX research ──► SAGE strategy ──► you approve / edit / ask for a revision
                                        │
          ┌──────────────┬──────────────┼───────────────┬─────────────┐
        NOVA           QUINN          REACH        ECHO / MAX / IVY   (parallel)
      content      search & AI     distribution   (only if switched on)
          └──────► PIXEL creative (from NOVA's posts)
                                        │
                      ARIA reviews everything; sends back what must change
                                        │
                     Approvals · Today · export · LYRA · weekly PULSE review
```

| Agent | Does | Runs |
|---|---|---|
| **REX** | Reads your site, searches the live web: competitors, pricing, pains, where your audience gathers | Every launch |
| **SAGE** | Positioning, audience, voice, channels, hero move, 90-day plan — **paused for your approval** | Every launch |
| **NOVA** | A dated content calendar, one platform per call, from the approved voice | After approval |
| **QUINN** | Real search phrases and questions; how to show up in Google and AI answers | After approval |
| **REACH** | Real communities, creators, publications, podcasts — each with a source link — and outreach drafts | After approval |
| **PIXEL** | Visual system from your brand colours; image prompts for NOVA's posts | After NOVA |
| **ECHO** | Launch story and press release | Only when "announcing a launch" |
| **MAX** | Ad campaign drafts within your budget and currency (nothing is ever spent) | Only with an ad budget |
| **IVY** | Sourced investor targets and narrative | Only when "currently raising" |
| **ARIA** | Reviews every draft; code checks + judgement; one targeted revision | Every run |
| **PULSE** | Weekly review from real activity and your numbers; proposes strategy changes for you to approve | On demand |
| **LYRA** | The assistant: answers anything, proposes actions you confirm with one click | Side panel |

## What it guarantees

- **Sourced or labelled.** A citation is kept only if the web search actually returned
  that page; anything else shows as *unverified*. A contact email is kept only if it
  appeared in a page the search read.
- **Valid output.** Every agent's output is defined once as a zod schema
  (`lib/engine/schemas.ts`), enforced on the model's reply, validated, and repaired once
  if needed. Pages render from the same schema.
- **Nothing silent.** A run that couldn't do something says so (warnings on the run).
  Stop really stops. A cancelled run can't later show "completed".
- **Your edits win.** Approved or edited items are never overwritten by a re-run;
  every change keeps the previous version. Rejecting with a reason teaches every agent
  (house rules).
- **Never sends on its own.** Outreach needs an address you confirmed, no placeholders,
  and a configured sender.
- **Usage is visible and capped.** Every AI call is recorded (`llm_calls`). Each run and
  each night has a cap (Settings), measured as API-equivalent value. On Claude Code
  nothing is billed per call.
- **Numbers are real or blank.** Exec reports take numbers only from facts gathered by
  code (git, the database) or that you entered. A number with no basis is removed.

## Development

On any system: `node scripts/markos.mjs start` brings up the database once, then the commands
below work. On an Apple Silicon Mac, make sure `node` is the arm64 build (`node -p process.arch` prints
`arm64`). An x86 Node under Rosetta works but is slow and can break the CSS build.

```bash
node scripts/native-db.mjs start                   # start the database (MarkOS does it on open)
node node_modules/next/dist/bin/next dev --port 3001
node node_modules/vitest/vitest.mjs run             # unit + integration tests (fake AI, local DB)
EVAL_PRODUCT="Your product" node node_modules/vitest/vitest.mjs run tests/eval-launch.test.ts   # real launch, real AI
node scripts/markos.mjs night                      # a night shift now, the way the schedule runs it
```

```
lib/llm/            provider-neutral AI layer (Claude Code default; Gemini, Anthropic API optional), ledger, caps
lib/engine/         brain (shared brief), agents, ARIA review, orchestrator, items, LYRA, schemas
lib/engine/execs/   the executive team: roster, facts, reports, tasks, Chief of Staff, intake, night shift
lib/social/         posting approved content to X / LinkedIn
app/(dashboard)/    Today, Approvals, Research, Strategy, Content, Distribution, Search, …
supabase/migrations the schema, then one file per later change (applied at start)
scripts/            markos.mjs (install, open, start, stop, night shift, backup; every system), native-db.mjs (the database),
                    paths.mjs (per-system folders); Mac extras: make-desktop-app.sh, night-shift.sh, lib-start.sh
```

## Licence

Apache-2.0. See [LICENSE](LICENSE). MarkOS is made by [Priberry](https://priberry.com), who also make
free tools that check AI-built apps and AI agents before launch: [Greenlit](https://greenlit.priberry.com),
[Launch Blockers](https://greenlit.priberry.com/blockers/), [Crumple](https://crumple.priberry.com) and
[Tare](https://tare.priberry.com).
