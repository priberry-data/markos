import { db } from '@/lib/db'
import { teamDefault } from '@/lib/llm/models'
import { ProviderError } from '@/lib/llm/types'
import { startJob } from '@/lib/utils/jobs'
import { describeFailure, startAgentRun, startLaunch } from '../orchestrator'
import { notify } from '../store'
import type { ExecKey, MorningBrief } from '../schemas'
import { writeBrief } from './chief-of-staff'
import { applyModelSettings, portfolio, type PortfolioProduct } from './context'
import { runIntake } from './intake'
import { writeReport } from './report'
import { createTasks, executeTask } from './tasks'
import { runChecks } from './qa'
import { draftOutreach } from './customers'
import { markMissedMeetings, planMeetings, retryCalendarSync } from './office'
import { EXECS } from './roster'

// The night shift. While the founder sleeps, the team works through the
// portfolio and the Chief of Staff writes the morning brief.
//
// It is built to fit a Claude plan's usage limits rather than to do
// everything every night:
//   - every product gets its cheap reports every night;
//   - the expensive marketing work rotates: a couple of products per night,
//     longest-waiting first;
//   - a nightly cap (API-equivalent value) stops the shift cleanly;
//   - if the plan's usage limit is hit, the shift waits for the reset when
//     that's before morning, and otherwise stops and says so in the brief.

const DAY = 86400_000
const DEEP_PER_NIGHT = 2
/** Stop waiting for a usage-limit reset after this local hour; the founder is up. */
const MORNING_HOUR = 7

type LogEntry = { at: string; step: string; status: 'done' | 'failed' | 'skipped'; detail?: string }

/** onlyProducts: limit the shift to these products (used by tests; never touches the rest). */
export async function startNight(trigger: 'schedule' | 'manual' = 'manual', opts: { onlyProducts?: string[] } = {}): Promise<string> {
  const supabase = db()
  const { data: running } = await supabase.from('nights').select('id').eq('status', 'running').maybeSingle()
  if (running) return running.id as string
  const { data, error } = await supabase.from('nights').insert({ trigger }).select('id').single()
  if (error) throw new Error(`Could not start the night shift: ${error.message}`)
  const id = data.id as string
  startJob(`night:${id}`, signal => runNight(id, signal, opts))
  return id
}

class StopNight extends Error {}

export async function runNight(nightId: string, signal: AbortSignal, opts: { onlyProducts?: string[] } = {}) {
  const scoped = Boolean(opts.onlyProducts?.length)
  const supabase = db()
  const started = new Date()
  const log: LogEntry[] = []
  const { data: profile } = await supabase.from('profiles').select('night_budget_usd').eq('id', 1).single()
  const budget = Number(profile?.night_budget_usd ?? 20)

  const save = (fields: Record<string, unknown> = {}) =>
    supabase.from('nights').update({ log, ...fields }).eq('id', nightId).then(({ error }) => {
      if (error) console.error('[night] could not save progress:', error.message)
    })

  const spent = async () => {
    const { data } = await supabase.from('llm_calls').select('cost_usd').gte('created_at', started.toISOString())
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  }

  /** Run one step; usage limits wait for the reset when that's before morning. */
  const step = async (name: string, fn: () => Promise<string | void>) => {
    if (signal.aborted) throw new StopNight('Stopped by you.')
    if (await spent() >= budget) throw new StopNight(`Tonight's usage cap ($${budget} API-equivalent) was reached.`)
    for (;;) {
      try {
        const detail = await fn()
        log.push({ at: new Date().toISOString(), step: name, status: 'done', detail: detail || undefined })
        await save()
        return
      } catch (err) {
        if (err instanceof ProviderError && err.kind === 'usage_limit') {
          // Only Claude Code has a plan limit. When the team runs on another AI, Claude Code was only
          // lent its web searches (or an agent set apart on it): the rest of the night needs neither,
          // so just this step is skipped (a queued task stays in the queue) and the night goes on.
          await applyModelSettings()
          const team = teamDefault()
          if (team && team.provider !== 'claude-code') {
            const when = err.resetAt ? ` (it resets at ${err.resetAt.toLocaleTimeString()})` : ''
            log.push({ at: new Date().toISOString(), step: name, status: 'skipped', detail: `Claude Code reached the Claude plan’s usage limit${when}. This team runs on another AI, so just this step is skipped (an instruction you queued stays queued for the next run); the rest of the night goes on.` })
            await save()
            return
          }
          const reset = err.resetAt
          const morning = new Date(); morning.setHours(MORNING_HOUR, 0, 0, 0)
          if (reset && reset < morning && reset > new Date()) {
            log.push({ at: new Date().toISOString(), step: name, status: 'skipped', detail: `Usage limit — waiting until ${reset.toLocaleTimeString()}` })
            await save({ paused_reason: 'Waiting for the Claude plan’s usage limit to reset', resume_after: reset.toISOString() })
            await sleepUntil(reset.getTime() + 120_000, signal)
            await save({ paused_reason: null, resume_after: null })
            continue
          }
          throw new StopNight(describeFailure(err).message)
        }
        if (err instanceof ProviderError && (err.kind === 'auth' || err.kind === 'not_configured')) {
          throw new StopNight(err.message)
        }
        log.push({ at: new Date().toISOString(), step: name, status: 'failed', detail: describeFailure(err).message })
        await save()
        return
      }
    }
  }

  let stopped: string | null = null
  try {
    const products = (await portfolio()).filter(p => (scoped ? opts.onlyProducts!.includes(p.id) : p.night_enabled))
    const plan = planNight(products)
    await save({ plan: plan.summary })

    await markMissedMeetings()

    // 0. QA's live checks — code, no AI, so they run even when usage is tight.
    for (const p of products.filter(p => p.url)) {
      await step(`QA checks · ${p.name}`, async () => {
        const checks = await runChecks(p.id)
        const failing = checks.filter(c => !c.ok).length
        return `${checks.length} pages checked${failing ? `, ${failing} failing` : ', all up'}`
      })
    }

    // The Data team's real numbers come first, so every report after uses them.
    const { dataConnections } = await import('./data-team')
    const connected = (await dataConnections()).filter(c => c.connected && products.some(p => p.id === c.id))
    for (const c of connected) {
      const [id] = await createTasks([{
        exec: 'data', productId: c.id, origin: 'night', nightId,
        task: 'Compute this week’s core numbers: total users, new sign-ups this week vs last, active users this week, the main key action, and paying users and revenue this month if those tables exist. Exclude test and internal accounts, and say how.',
      }])
      await step(`Data · ${c.name}`, async () => { await executeTask(id, signal); return 'Core numbers computed from the database' })
    }

    // 1. Learn any product the team hasn't read yet (a draft for the founder to confirm).
    for (const p of products.filter(p => p.intake_status === 'none')) {
      await step(`Intake · ${p.name}`, async () => { await runIntake(p.id, signal); return 'Profile drafted — confirm it in Portfolio' })
    }

    // Goals: if the company has none, the Chief of Staff drafts them for the founder.
    const { count: goalCount } = await supabase.from('goals').select('id', { count: 'exact', head: true }).in('status', ['active', 'proposed'])
    if (!goalCount && !scoped) {
      await step('Chief of Staff · drafting goals', async () => {
        const { proposeGoals } = await import('./goals')
        return `${await proposeGoals(signal)} goals drafted for you to confirm`
      })
    }

    // 2. The founder's queued instructions come before anything the team chose.
    await runQueuedTasks(nightId, step, signal, scoped ? opts.onlyProducts : undefined)

    // 3. Marketing work, rotating through the portfolio.
    for (const p of plan.deep) {
      await step(`Marketing · ${p.name}`, () => marketingPass(p, signal))
      await supabase.from('products').update({ last_deep_night: new Date().toISOString() }).eq('id', p.id)
      const [prospecting] = await createTasks([{
        exec: 'sales', productId: p.id, origin: 'night', nightId,
        task: `Find up to 8 new organisations worth approaching for ${p.name} — design partners, customers, colleges, partners or communities, whichever fits its goals. Skip anyone already in the pipeline. Draft a short pitch for each.`,
      }])
      await step(`Prospecting · ${p.name}`, async () => {
        await executeTask(prospecting, signal)
        return 'Prospects added to the pipeline'
      })
    }

    // 4. The Customer team drafts this week's conversations, where there are customers.
    for (const p of products) {
      const { count } = await db().from('customers').select('id', { count: 'exact', head: true }).eq('product_id', p.id)
      if (count) await step(`Customer outreach · ${p.name}`, async () => `${await draftOutreach(p.id, signal)} drafts for you to approve`)
    }

    // 5. Every exec reports.
    for (const p of products) {
      const { count: customers } = await db().from('customers').select('id', { count: 'exact', head: true }).eq('product_id', p.id)
      for (const exec of ['data', 'qa', 'cpo', 'cto', 'cmo', 'sales', 'cx'] as ExecKey[]) {
        if (exec === 'cto' && p.repo_paths.length === 0) continue
        if (exec === 'cx' && !customers) continue
        if (exec === 'data' && !connected.some(c => c.id === p.id)) continue
        await step(`${EXECS[exec].title} report · ${p.name}`, async () => {
          const { report } = await writeReport({ exec, productId: p.id, nightId, signal })
          return report.headline
        })
      }
    }
    for (const exec of (scoped ? [] : ['cfo', 'coo', 'platform']) as ExecKey[]) {
      await step(`${EXECS[exec].title} report · portfolio`, async () => {
        const { report } = await writeReport({ exec, productId: null, nightId, signal })
        return report.headline
      })
    }

    // 6. Work the execs handed each other, and moves they decided to make.
    await runQueuedTasks(nightId, step, signal, scoped ? opts.onlyProducts : undefined)

    // 7. The Executive Assistant books what needs the founder.
    await step('Myra · your calendar', async () => {
      await retryCalendarSync()
      const booked = await planMeetings(nightId, signal)
      return booked.length ? `${booked.length} meeting(s) booked` : 'No meetings needed'
    })
  } catch (err) {
    stopped = err instanceof StopNight ? err.message : describeFailure(err).message
    log.push({ at: new Date().toISOString(), step: 'Night shift', status: 'failed', detail: stopped })
  }

  // 6. The morning brief — written even after a short night, so the founder
  //    always wakes up to an honest account.
  let brief: MorningBrief | null = null
  if (!signal.aborted) {
    try {
      await save({ paused_reason: stopped })
      brief = await writeBrief(nightId)
    } catch (err) {
      brief = fallbackBrief(log, stopped ?? describeFailure(err).message)
      await supabase.from('nights').update({ brief }).eq('id', nightId)
    }
  }

  const failed = log.filter(l => l.status === 'failed').length
  await save({
    status: signal.aborted ? 'cancelled' : stopped ? 'partial' : failed ? 'partial' : 'completed',
    paused_reason: stopped,
    finished_at: new Date().toISOString(),
  })
  if (brief) {
    await notify(null, { type: 'brief', title: 'Your morning brief is ready', message: brief.headline, actionUrl: '/brief' })
  }
}

/** Which products get the expensive marketing pass tonight: longest-waiting first. */
export function planNight(products: PortfolioProduct[]) {
  const deep = [...products]
    .filter(p => p.intake_status !== 'none')
    .sort((a, b) => (a.last_deep_night ? Date.parse(a.last_deep_night) : 0) - (b.last_deep_night ? Date.parse(b.last_deep_night) : 0))
    .slice(0, DEEP_PER_NIGHT)
  return {
    deep,
    summary: [
      'QA live checks',
      ...products.filter(p => p.intake_status === 'none').map(p => `Intake: ${p.name}`),
      'Your queued instructions',
      ...deep.map(p => `Marketing + prospecting: ${p.name}`),
      `Reports: ${products.length} products + finance and operations`,
      'Your calendar (Myra)',
      'Morning brief',
    ],
  }
}

/** What the CMO's team does for one product tonight. Waits for each run to finish. */
async function marketingPass(p: PortfolioProduct, signal: AbortSignal): Promise<string> {
  const supabase = db()
  const { data: brain } = await supabase.from('product_brains').select('strategy_status').eq('product_id', p.id).maybeSingle()
  const status = brain?.strategy_status ?? 'none'

  if (status === 'none') {
    const runId = await startLaunch(p.id)
    const run = await waitForRun(runId, signal)
    return run === 'awaiting_approval' ? 'Research and a strategy draft are ready for your approval' : `Planning ${run}`
  }
  if (status === 'draft') return 'Waiting for you to approve the strategy — nothing else runs until then'

  const done: string[] = []
  const { count: upcoming } = await supabase.from('content_items').select('id', { count: 'exact', head: true })
    .eq('product_id', p.id).in('status', ['draft', 'approved']).gte('scheduled_at', new Date().toISOString())
  if ((upcoming ?? 0) < 5) {
    done.push(`content ${await waitForRun(await startAgentRun(p.id, 'content'), signal)}`)
  }
  for (const agent of ['search', 'distribution'] as const) {
    const { data: last } = await supabase.from('agent_outputs').select('created_at')
      .eq('product_id', p.id).eq('agent_name', agent).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!last || Date.now() - Date.parse(last.created_at as string) > 7 * DAY) {
      done.push(`${agent} ${await waitForRun(await startAgentRun(p.id, agent), signal)}`)
    }
  }
  return done.length ? done.join(', ') : 'Calendar is full and research is fresh — nothing to redo'
}

async function waitForRun(runId: string, signal: AbortSignal): Promise<string> {
  for (;;) {
    const { data } = await db().from('agent_runs').select('status, error_message').eq('id', runId).single()
    const status = data?.status as string
    if (['completed', 'completed_with_warnings', 'awaiting_approval', 'cancelled'].includes(status)) return status
    if (status === 'failed') {
      // Surface a usage-limit stop so the shift can pause instead of moving on.
      if (/usage limit/i.test(data?.error_message ?? '')) throw new ProviderError(data!.error_message, 'usage_limit')
      return `failed (${data?.error_message ?? 'unknown'})`
    }
    await sleepUntil(Date.now() + 5000, signal)
  }
}

async function runQueuedTasks(
  nightId: string,
  step: (name: string, fn: () => Promise<string | void>) => Promise<void>,
  signal: AbortSignal,
  onlyProducts?: string[],
) {
  // The founder's own to-dos are tracked, never executed by an agent.
  let q = db().from('tasks').select('id, exec, task, priority').eq('status', 'queued').neq('exec', 'founder')
  if (onlyProducts) q = q.in('product_id', onlyProducts)
  const { data: queued } = await q.order('created_at').limit(20)
  const order = { high: 0, normal: 1, low: 2 } as const
  for (const t of (queued ?? []).sort((a, b) => order[a.priority as keyof typeof order] - order[b.priority as keyof typeof order])) {
    await step(`${EXECS[t.exec as ExecKey]?.title ?? t.exec} · ${String(t.task).slice(0, 60)}`, async () => {
      await db().from('tasks').update({ night_id: nightId }).eq('id', t.id)
      await executeTask(t.id as string, signal)
    })
  }
}

function sleepUntil(at: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, Math.max(0, at - Date.now()))
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new StopNight('Stopped by you.')) }, { once: true })
  })
}

/** When even the brief can't be written (e.g. the usage limit), the founder still gets the facts. */
export function fallbackBrief(log: LogEntry[], reason: string): MorningBrief {
  const done = log.filter(l => l.status === 'done')
  // A step whose last entry is 'skipped' never ran (a wait that ended in a re-run has a later entry).
  const skipped = [...new Map(log.map(l => [l.step, l])).values()].filter(l => l.status === 'skipped')
  return {
    headline: `The night shift was cut short: ${reason}`,
    the_one_thing: { product: null, focus: 'Fix what stopped the night shift', why: reason },
    moves: [],
    top_decisions: [],
    overnight: done.slice(-12).map(l => ({ product: null, summary: `${l.step}${l.detail ? ` — ${l.detail}` : ''}` })),
    per_product: [],
    risks: [
      ...log.filter(l => l.status === 'failed').map(l => `${l.step}: ${l.detail ?? 'failed'}`),
      ...skipped.map(l => `${l.step}: ${l.detail ?? 'skipped'}`),
    ],
    today_focus: ['Open the exec reports below for what did finish.'],
  }
}
