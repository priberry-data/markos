import { db } from '@/lib/db'
import { BudgetExceededError, InvalidOutputError, ProviderError, type CallContext } from '@/lib/llm'
import { AGENTS, setModelOverrides, type AgentKey } from '@/lib/llm/models'
import { cancelJob, startJob } from '@/lib/utils/jobs'
import { adBudget, loadBrain, type Brain } from './brain'
import { runResearch } from './agents/research'
import { runStrategy } from './agents/strategy'
import { runContent } from './agents/content'
import { runSearch } from './agents/search'
import { runDistribution } from './agents/distribution'
import { runCreative } from './agents/creative'
import { runPR } from './agents/pr'
import { runAds } from './agents/ads'
import { runInvestor } from './agents/investor'
import { runWeeklyReview } from './agents/review'
import { notify, recordSources, saveOutput, setStep, updateRun } from './store'
import type { Strategy } from './schemas'
import { reviewAndRevise } from './review'
import { findPlaceholder } from './sources'

// ARIA — the orchestrator.
//
// A launch is:  research → strategy → PAUSE for the founder → production
// agents in parallel → director review and revisions → done.
//
// Every AI call carries the run's AbortSignal, so Stop really stops. Every
// output is validated and saved the moment its agent finishes, so one agent
// failing never discards another's work. A cancelled run can never be
// overwritten as completed.

export interface RunSettings {
  budgetUsd: number
}

async function loadSettings(): Promise<RunSettings> {
  const { data } = await db().from('profiles').select('agent_models, run_budget_usd').eq('id', 1).single()
  setModelOverrides((data?.agent_models ?? {}) as Partial<Record<AgentKey, string>>)
  return { budgetUsd: Number(data?.run_budget_usd ?? 1) }
}

/** A plain-language reason for a failure, for the run card and notification. */
export function describeFailure(err: unknown): { message: string; actionUrl?: string } {
  if (err instanceof BudgetExceededError) return { message: err.message, actionUrl: '/settings' }
  if (err instanceof ProviderError) {
    if (err.kind === 'not_configured' || err.kind === 'auth' || err.kind === 'billing') {
      return { message: err.message, actionUrl: '/settings' }
    }
    if (err.kind === 'usage_limit') {
      const when = err.resetAt ? ` It resets around ${err.resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''
      return { message: `Your Claude plan's usage limit was reached, so the team paused.${when} Work already saved is kept.` }
    }
    return { message: err.message }
  }
  if (err instanceof InvalidOutputError) return { message: `${err.message} (${err.issues.split('\n')[0]})` }
  return { message: err instanceof Error ? err.message : String(err) }
}

function isAbort(err: unknown, signal: AbortSignal) {
  return signal.aborted || (err instanceof ProviderError && err.kind === 'aborted')
}

/** Run one agent step: status bookkeeping around the agent's own work. */
async function step<T>(runId: string, agent: AgentKey, fn: () => Promise<T>): Promise<T> {
  await setStep(runId, agent, 'running')
  await updateRun(runId, { phase: agent })
  try {
    const result = await fn()
    return result
  } catch (err) {
    await setStep(runId, agent, 'failed', { detail: describeFailure(err).message }).catch(() => {})
    throw err
  }
}

// ── starting a launch ───────────────────────────────────────────────────────

/** Start a full launch for a product. Any run already in progress for it is stopped first. */
export async function startLaunch(productId: string): Promise<string> {
  const supabase = db()

  const { data: active } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('product_id', productId)
    .in('status', ['running', 'awaiting_approval'])
  for (const run of active ?? []) {
    cancelJob(run.id, 'Replaced by a new launch')
    await updateRun(run.id, { status: 'cancelled', phase: null, error: 'Replaced by a new launch.' })
  }

  const { data: run, error } = await supabase
    .from('agent_runs')
    .insert({ product_id: productId, run_type: 'launch', status: 'running', phase: 'research', progress_percent: 5 })
    .select('id')
    .single()
  if (error || !run) throw new Error(`Could not start the launch: ${error?.message}`)

  await Promise.all((['research', 'strategy'] as AgentKey[]).map(a => setStep(run.id, a, 'queued')))
  startJob(run.id, signal => planningPhase(run.id, productId, signal))
  return run.id
}

async function planningPhase(runId: string, productId: string, signal: AbortSignal) {
  try {
    const settings = await loadSettings()
    const ctx = (agent: AgentKey): CallContext => ({ agent, runId, productId, signal, budgetUsd: settings.budgetUsd })
    let brain = await loadBrain(productId)

    // REX — research
    const research = await step(runId, 'research', async () => {
      const result = await runResearch(ctx('research'), brain)
      const saved = await saveOutput({
        runId, productId, agent: 'research', outputType: 'research_dossier',
        content: result.research, sources: result.sources,
      })
      await recordSources(productId, 'research', runId, result.sources)
      const { error } = await db().from('product_brains').upsert({
        product_id: productId,
        research: result.research,
        research_output_id: saved.id,
        updated_at: new Date().toISOString(),
      })
      if (error) throw new Error(`Could not save research: ${error.message}`)
      const notes = [
        `${result.sources.length} sources`,
        result.siteRead ? null : 'your website could not be read',
        result.removedCitations ? `${result.removedCitations} unsupported citations removed` : null,
      ].filter(Boolean).join(' · ')
      await setStep(runId, 'research', 'done', { detail: notes, outputId: saved.id })
      return result
    })
    await updateRun(runId, { progress: 20 })
    brain = { ...brain, research: research.research }

    // SAGE — strategy (draft until the founder approves it)
    await step(runId, 'strategy', async () => {
      const strategy = await runStrategy(ctx('strategy'), brain)
      await saveDraftStrategy(runId, productId, strategy)
    })

    await updateRun(runId, { status: 'awaiting_approval', phase: 'awaiting_approval', progress: 30 })
    await notify(productId, {
      type: 'approval_needed',
      title: 'Your strategy is ready',
      message: `SAGE drafted a strategy for ${brain.product.name} from ${research.sources.length} live sources. Review it, edit anything, then approve to start the content.`,
      actionUrl: '/strategy',
    })
  } catch (err) {
    await failRun(runId, productId, err, signal)
  }
}

async function saveDraftStrategy(runId: string, productId: string, strategy: Strategy) {
  const saved = await saveOutput({
    runId, productId, agent: 'strategy', outputType: 'strategy_document', content: strategy, status: 'draft',
  })
  const { error } = await db().from('product_brains').upsert({
    product_id: productId,
    strategy,
    strategy_output_id: saved.id,
    strategy_status: 'draft',
    strategy_approved_at: null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Could not save the strategy: ${error.message}`)
  await setStep(runId, 'strategy', 'done', { detail: 'Waiting for your approval', outputId: saved.id })
}

async function failRun(runId: string, productId: string, err: unknown, signal: AbortSignal) {
  if (isAbort(err, signal)) {
    await updateRun(runId, { status: 'cancelled', phase: null, error: 'Stopped by you.' }).catch(() => {})
    return
  }
  const { message, actionUrl } = describeFailure(err)
  console.error(`[markos] run ${runId} failed:`, err)
  await updateRun(runId, { status: 'failed', phase: null, error: message }).catch(() => {})
  await notify(productId, { type: 'agent_error', title: 'A run needs your attention', message, actionUrl })
}

// ── approval ────────────────────────────────────────────────────────────────

/**
 * The founder approves the strategy — optionally edited. The approved version
 * becomes canonical in the product brain and every later agent writes from it.
 */
export async function approveStrategy(productId: string, edited?: Strategy): Promise<string | null> {
  const supabase = db()
  const { data: brainRow } = await supabase.from('product_brains').select('strategy, strategy_output_id').eq('product_id', productId).single()
  if (!brainRow?.strategy) throw new Error('There is no strategy to approve yet.')

  const strategy = (edited ?? brainRow.strategy) as Strategy
  const { error } = await supabase.from('product_brains').update({
    strategy,
    strategy_status: 'approved',
    strategy_approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('product_id', productId)
  if (error) throw new Error(`Could not approve the strategy: ${error.message}`)

  if (brainRow.strategy_output_id) {
    await supabase.from('agent_outputs')
      .update({ status: 'current', ...(edited ? { content_json: strategy } : {}) })
      .eq('id', brainRow.strategy_output_id)
  }
  await supabase.from('approvals').update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('product_id', productId).eq('output_type', 'strategy_document').eq('status', 'pending')

  // Continue the paused launch, if there is one.
  const { data: run } = await supabase.from('agent_runs').select('id')
    .eq('product_id', productId).eq('status', 'awaiting_approval')
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!run) return null

  await setStep(run.id, 'strategy', 'done', { detail: edited ? 'Approved with your edits' : 'Approved by you' })
  await updateRun(run.id, { status: 'running', phase: 'production', progress: 35 })
  startJob(run.id, signal => productionPhase(run.id, productId, signal))
  return run.id
}

/**
 * Ask SAGE for a new draft, guided by the founder's notes ("less corporate",
 * "we don't sell to enterprises"). The result comes back as a draft to review.
 */
export async function reviseStrategy(productId: string, notes: string): Promise<string> {
  const { data: run, error } = await db()
    .from('agent_runs')
    .insert({ product_id: productId, run_type: 'strategy_revision', status: 'running', phase: 'strategy', progress_percent: 10 })
    .select('id')
    .single()
  if (error || !run) throw new Error(`Could not start the revision: ${error?.message}`)
  await setStep(run.id, 'strategy', 'queued')

  startJob(run.id, async signal => {
    try {
      const settings = await loadSettings()
      const brain = await loadBrain(productId)
      const previous = brain.strategy
      await step(run.id, 'strategy', async () => {
        const strategy = await runStrategy(
          { agent: 'strategy', runId: run.id, productId, signal, budgetUsd: settings.budgetUsd },
          brain,
          `${notes}${previous ? `\n\nThe previous draft's positioning was: "${previous.positioning_statement}". Keep what the notes don't ask you to change.` : ''}`,
        )
        await saveDraftStrategy(run.id, productId, strategy)
      })
      await updateRun(run.id, { status: 'completed', phase: null, progress: 100 })
      await notify(productId, {
        type: 'approval_needed',
        title: 'SAGE revised your strategy',
        message: 'A new draft is ready for your review.',
        actionUrl: '/strategy',
      })
    } catch (err) {
      await failRun(run.id, productId, err, signal)
    }
  })
  return run.id
}

/** Stop a run. The job is aborted mid-call and the run can never later show "completed". */
export async function cancelRun(runId: string): Promise<void> {
  cancelJob(runId)
  await updateRun(runId, { status: 'cancelled', phase: null, error: 'Stopped by you.' })
}

// ── production ──────────────────────────────────────────────────────────────

/** The agents that write from the approved strategy. */
export const PRODUCTION_AGENTS: AgentKey[] = ['content', 'search', 'distribution', 'creative', 'pr', 'ads', 'investor']

/** Why an agent doesn't apply to this product right now, or null if it does. */
export function skipReason(agent: AgentKey, brain: Brain): string | null {
  if (agent === 'pr' && !brain.product.announcing_launch) return 'Only runs when you are announcing a launch'
  if (agent === 'ads' && adBudget(brain.product) === 0) return 'No ad budget set'
  if (agent === 'investor' && !brain.product.raising) return 'Only runs when you are raising'
  return null
}

interface StepResult {
  detail: string
  outputId?: string
  warnings?: string[]
}

/**
 * Run one agent as a step of a run. A failure is recorded and returned as a
 * warning so the other agents' work stands; a cancellation stops everything.
 */
async function agentStep(
  runId: string, agent: AgentKey, signal: AbortSignal, warnings: string[], fn: () => Promise<StepResult>,
): Promise<boolean> {
  await setStep(runId, agent, 'running')
  try {
    const r = await fn()
    await setStep(runId, agent, 'done', { detail: r.detail, outputId: r.outputId ?? null })
    warnings.push(...(r.warnings ?? []))
    return true
  } catch (err) {
    if (isAbort(err, signal)) throw err
    const { message } = describeFailure(err)
    await setStep(runId, agent, 'failed', { detail: message })
    warnings.push(`${AGENTS[agent].name} failed: ${message}`)
    // Setup problems (no key, no credit, budget spent) won't fix themselves
    // agent by agent — stop the run and say so.
    if (err instanceof BudgetExceededError) throw err
    if (err instanceof ProviderError && ['not_configured', 'auth', 'billing', 'usage_limit'].includes(err.kind)) throw err
    return false
  }
}

async function runAgents(runId: string, productId: string, agents: AgentKey[], signal: AbortSignal): Promise<string[]> {
  const settings = await loadSettings()
  const brain = await loadBrain(productId)
  if (brain.strategyStatus !== 'approved') throw new Error('Approve the strategy first — every agent writes from it.')

  const ctx = (agent: AgentKey): CallContext => ({ agent, runId, productId, signal, budgetUsd: settings.budgetUsd })
  const warnings: string[] = []

  const active: AgentKey[] = []
  for (const agent of agents) {
    const reason = skipReason(agent, brain)
    if (reason) await setStep(runId, agent, 'skipped', { detail: reason })
    else {
      active.push(agent)
      await setStep(runId, agent, 'queued')
    }
  }

  const has = (a: AgentKey) => active.includes(a)
  const run = (agent: AgentKey, fn: () => Promise<StepResult>) => agentStep(runId, agent, signal, warnings, fn)

  // Wave 1 — independent agents, in parallel. Each saves its own output the
  // moment it finishes.
  const wave1: Promise<boolean>[] = []
  let contentOk = false
  if (has('content')) {
    wave1.push(run('content', async () => {
      const r = await runContent(ctx('content'), brain, { runId })
      contentOk = true
      return {
        detail: `${r.pieces} pieces across ${r.platforms.join(', ')}`,
        outputId: r.outputId,
        warnings: r.failures.map(f => `NOVA couldn't write ${f}`),
      }
    }))
  }
  if (has('search')) {
    wave1.push(run('search', async () => {
      const r = await runSearch(ctx('search'), brain, { runId })
      return { detail: `${r.keywords} keywords from ${r.sources} sources`, outputId: r.outputId }
    }))
  }
  if (has('distribution')) {
    wave1.push(run('distribution', async () => {
      const r = await runDistribution(ctx('distribution'), brain, { runId })
      return {
        detail: `${r.targets} targets, ${r.verified} with a source`,
        outputId: r.outputId,
        warnings: r.droppedContacts
          ? [`REACH proposed ${r.droppedContacts} contact(s) that didn't appear in any page it read — removed`]
          : [],
      }
    }))
  }
  if (has('pr')) wave1.push(run('pr', async () => ({ detail: 'Launch story and press release', outputId: (await runPR(ctx('pr'), brain, { runId })).outputId })))
  if (has('ads')) wave1.push(run('ads', async () => {
    const r = await runAds(ctx('ads'), brain, { runId })
    return { detail: `${r.campaigns} campaign draft(s)`, outputId: r.outputId }
  }))
  if (has('investor')) wave1.push(run('investor', async () => {
    const r = await runInvestor(ctx('investor'), brain, { runId })
    return { detail: `${r.targets} investor targets`, outputId: r.outputId }
  }))

  await Promise.all(wave1)
  await updateRun(runId, { progress: 75 })

  // Wave 2 — PIXEL illustrates the content NOVA actually wrote.
  if (has('creative')) {
    await run('creative', async () => {
      const { data: pieces } = await db().from('content_items')
        .select('platform, title').eq('product_id', productId).in('status', ['draft', 'approved', 'scheduled'])
        .order('scheduled_at').limit(10)
      const r = await runCreative(ctx('creative'), brain, {
        runId,
        contentTitles: contentOk || has('content') ? (pieces ?? []) : [],
      })
      return { detail: `${r.prompts} image prompts`, outputId: r.outputId }
    })
  }

  // ARIA reviews what was produced in this run and sends back what must change.
  const { data: doneSteps } = await db().from('run_steps').select('agent').eq('run_id', runId).eq('status', 'done')
  const produced = (doneSteps ?? []).map(s => s.agent as AgentKey).filter(a => PRODUCTION_AGENTS.includes(a))
  if (produced.length) {
    await updateRun(runId, { phase: 'review', progress: 85 })
    await agentStep(runId, 'director', signal, warnings, async () => {
      const outcomes = await reviewAndRevise(ctx, brain, runId, produced)
      const revised = outcomes.filter(o => o.revised).map(o => AGENTS[o.agent].name)
      const unfixed = outcomes.filter(o => o.verdict === 'revise' && !o.revised)
      return {
        detail: outcomes.length === 0
          ? 'Nothing to review'
          : revised.length
            ? `Reviewed ${outcomes.length}; sent ${revised.join(', ')} back for a revision`
            : `Reviewed ${outcomes.length}; all passed`,
        warnings: unfixed.map(o => `ARIA flagged ${AGENTS[o.agent].name}'s work but the revision failed: ${o.error ?? 'unknown error'}`),
      }
    })
  }

  // Warnings describe the final state, after ARIA's revisions — not a problem
  // that has since been fixed.
  warnings.push(...(await auditPlaceholders(productId)))
  return warnings
}

/** Template gaps like [Name] still present in drafts the founder might post or send. */
async function auditPlaceholders(productId: string): Promise<string[]> {
  const supabase = db()
  const [{ data: pieces }, { data: targets }] = await Promise.all([
    supabase.from('content_items').select('title, body').eq('product_id', productId).eq('status', 'draft'),
    supabase.from('outreach_targets').select('name, outreach_draft, draft_subject').eq('product_id', productId).in('status', ['identified', 'draft_ready']),
  ])
  const badPieces = (pieces ?? []).filter(p => findPlaceholder(p.body) || findPlaceholder(p.title)).length
  const badDrafts = (targets ?? []).filter(t => findPlaceholder(t.outreach_draft) || findPlaceholder(t.draft_subject)).length
  return [
    ...(badPieces ? [`${badPieces} content piece(s) still contain a template gap like [Name] — fix before posting`] : []),
    ...(badDrafts ? [`${badDrafts} outreach draft(s) still contain a [placeholder] — sending is blocked until you fix them`] : []),
  ]
}

async function finishRun(runId: string, productId: string, warnings: string[], label: string) {
  const { data: steps } = await db().from('run_steps').select('status').eq('run_id', runId)
  const ran = (steps ?? []).filter(s => s.status !== 'skipped')
  const failed = ran.filter(s => s.status === 'failed').length
  if (ran.length > 0 && failed === ran.length) {
    await updateRun(runId, { status: 'failed', phase: null, warnings, error: warnings[0] ?? 'Every agent failed.' })
    await notify(productId, { type: 'agent_error', title: `${label} failed`, message: warnings[0] ?? 'Every agent failed.' })
    return
  }
  await updateRun(runId, {
    status: warnings.length ? 'completed_with_warnings' : 'completed',
    phase: null,
    progress: 100,
    warnings,
  })
  await notify(productId, {
    type: warnings.length ? 'run_warnings' : 'agent_complete',
    title: warnings.length ? `${label} finished with ${warnings.length} note(s)` : `${label} finished`,
    message: warnings.length ? warnings[0] : 'Your content, search plan and distribution targets are ready for review.',
    actionUrl: '/approvals',
  })
}

async function productionPhase(runId: string, productId: string, signal: AbortSignal) {
  try {
    const warnings = await runAgents(runId, productId, PRODUCTION_AGENTS, signal)
    await finishRun(runId, productId, warnings, 'Your launch')
  } catch (err) {
    await failRun(runId, productId, err, signal)
  }
}

/**
 * Run a single agent again, from the current approved strategy. Its previous
 * untouched drafts are superseded; anything you approved or edited is kept.
 */
export async function startAgentRun(productId: string, agent: AgentKey): Promise<string> {
  if (agent === 'research' || agent === 'strategy') return startLaunch(productId)
  if (agent === 'review') return startWeeklyReview(productId)
  if (!PRODUCTION_AGENTS.includes(agent)) throw new Error(`${AGENTS[agent].name} can't be run on its own.`)

  const brain = await loadBrain(productId)
  if (brain.strategyStatus !== 'approved') throw new Error('Approve the strategy first — every agent writes from it.')

  const { data: run, error } = await db()
    .from('agent_runs')
    .insert({ product_id: productId, run_type: `agent:${agent}`, status: 'running', phase: 'production', progress_percent: 10 })
    .select('id')
    .single()
  if (error || !run) throw new Error(`Could not start ${AGENTS[agent].name}: ${error?.message}`)

  startJob(run.id, async signal => {
    try {
      const warnings = await runAgents(run.id, productId, [agent], signal)
      await finishRun(run.id, productId, warnings, AGENTS[agent].name)
    } catch (err) {
      await failRun(run.id, productId, err, signal)
    }
  })
  return run.id
}

/** PULSE: review the week from real numbers; proposed changes go to the founder. */
export async function startWeeklyReview(productId: string): Promise<string> {
  const brain = await loadBrain(productId)
  if (brain.strategyStatus !== 'approved') throw new Error('Approve the strategy first — the review measures against it.')

  const { data: run, error } = await db()
    .from('agent_runs')
    .insert({ product_id: productId, run_type: 'weekly_review', status: 'running', phase: 'review', progress_percent: 10 })
    .select('id')
    .single()
  if (error || !run) throw new Error(`Could not start the review: ${error?.message}`)
  await setStep(run.id, 'review', 'queued')

  startJob(run.id, async signal => {
    try {
      const settings = await loadSettings()
      const warnings: string[] = []
      await agentStep(run.id, 'review', signal, warnings, async () => {
        const r = await runWeeklyReview({ agent: 'review', runId: run.id, productId, signal, budgetUsd: settings.budgetUsd }, brain, { runId: run.id })
        return { detail: r.changes ? `${r.changes} suggested strategy change(s) for you to review` : 'No strategy changes suggested', outputId: r.outputId }
      })
      await updateRun(run.id, { status: warnings.length ? 'failed' : 'completed', phase: null, progress: 100, warnings, error: warnings[0] ?? null })
      if (!warnings.length) {
        await notify(productId, { type: 'analytics_ready', title: 'Your weekly review is ready', message: 'PULSE reviewed the week from what actually happened.', actionUrl: '/review' })
      }
    } catch (err) {
      await failRun(run.id, productId, err, signal)
    }
  })
  return run.id
}

export { AGENTS }
