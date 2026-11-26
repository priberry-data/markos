import { z } from 'zod'
import { CHARTER } from './charter'
import { db } from '@/lib/db'
import { generateObject, type CallContext } from '@/lib/llm'
import { AGENTS, type AgentKey } from '@/lib/llm/models'
import type { Source } from '@/lib/llm/types'
import { adBudget, currencyFor, renderBrief, type Brain } from './brain'
import {
  AdsSchema, ContentPlatformSchema, CreativeSchema, DistributionSchema, InvestorSchema, PRSchema,
  ReviewNotesSchema, SearchSchema, type Ads, type Distribution, type ReviewNotes,
} from './schemas'
import { findPlaceholder, verifySources } from './sources'
import { knownSources, saveOutput } from './store'
import { persistContent, type ContentOutput } from './agents/content'
import { persistSearch } from './agents/search'
import { persistDistribution } from './agents/distribution'

// ARIA — the director's review.
//
// After the production agents finish, ARIA checks each output against the
// approved strategy, the brand voice and a fixed rubric, and sends back what
// must change. Agents that fail get exactly one targeted revision. This is the
// team's real communication: the old "message bus" was a log the orchestrator
// wrote to itself, including a canned reply in another agent's voice.

type Issue = ReviewNotes['issues'][number]

interface Reviewable<T> {
  schema: z.ZodType<T>
  /** Compact text of the output for the review prompt. */
  summarize: (data: T) => string
  /** Problems code can find for certain — no model needed. */
  checks: (data: T, brain: Brain) => Issue[]
  /** Save a revised version exactly the way the agent saves its own. */
  persist: (brain: Brain, data: T, runId: string | null, sources: Source[]) => Promise<void>
  /** Rules a revision must not break (e.g. no new contacts). */
  guard?: (revised: T, previous: T) => T
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const mustFix = (problem: string, fix: string): Issue => ({ severity: 'must_fix', problem, fix })

const ContentOutputSchema = z.object({
  calendars: z.array(ContentPlatformSchema),
  failed_platforms: z.array(z.string()),
})

const REVIEWABLE: Partial<Record<AgentKey, Reviewable<unknown>>> = {
  content: {
    schema: ContentOutputSchema,
    summarize: d => (d as ContentOutput).calendars.map(c =>
      `### ${c.platform}\n` + c.pieces.map(p => `- Day ${p.day}: "${p.title}" — hook: ${p.hook}\n  ${clip(p.body.replace(/\s+/g, ' '), 350)}`).join('\n')
    ).join('\n\n'),
    checks: d => {
      const issues: Issue[] = []
      for (const cal of (d as ContentOutput).calendars) {
        const hooks = new Map<string, number>()
        for (const p of cal.pieces) {
          const gap = findPlaceholder(p.body) ?? findPlaceholder(p.title)
          if (gap) issues.push(mustFix(`${cal.platform} "${p.title}" contains the placeholder ${gap}.`, 'Write the actual text so it can be posted as-is.'))
          if (!p.body.trim()) issues.push(mustFix(`${cal.platform} "${p.title}" has no body.`, 'Write the full post.'))
          const key = p.hook.toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 40)
          hooks.set(key, (hooks.get(key) ?? 0) + 1)
          const isThread = /^\s*1[/.)]/m.test(p.body) && /^\s*2[/.)]/m.test(p.body)
          if (cal.platform === 'twitter' && !isThread && p.body.length > 280) {
            issues.push(mustFix(`X post "${p.title}" is ${p.body.length} characters.`, 'Cut it under 280 characters, or make it a numbered thread.'))
          }
        }
        const repeated = [...hooks.values()].filter(n => n > 1).length
        if (repeated) issues.push(mustFix(`${repeated} ${cal.platform} hook(s) repeat another piece's opening.`, 'Give every piece a distinct opening line.'))
      }
      return issues
    },
    persist: async (brain, data, runId) => { await persistContent(brain, data as ContentOutput, runId) },
  },

  search: {
    schema: SearchSchema,
    summarize: d => clip(JSON.stringify(d), 9000),
    checks: () => [],
    persist: async (brain, data, runId, sources) => { await persistSearch(brain, data as z.infer<typeof SearchSchema>, sources, runId) },
  },

  distribution: {
    schema: DistributionSchema,
    summarize: d => {
      const x = d as Distribution
      return [
        ...x.targets.map(t => `- [${t.type}] ${t.name} (${t.platform}) — fit: ${t.why_fit}\n  draft: ${clip(t.draft_message.replace(/\s+/g, ' '), 300)}`),
        ...x.community_posts.map(p => `- community post for ${p.community}: "${p.title}" — ${clip(p.body.replace(/\s+/g, ' '), 250)}`),
      ].join('\n')
    },
    checks: d => {
      const issues: Issue[] = []
      for (const t of (d as Distribution).targets) {
        const gap = findPlaceholder(t.draft_message) ?? findPlaceholder(t.draft_subject)
        if (gap) issues.push(mustFix(`The message to ${t.name} contains the placeholder ${gap}.`, 'Rewrite it so it needs no placeholder.'))
      }
      return issues
    },
    persist: async (brain, data, runId, sources) => { await persistDistribution(brain, data as Distribution, sources, runId) },
    // A revision may reword messages but may not introduce a contact that the
    // original research didn't find.
    guard: (revised, previous) => {
      const found = new Set((previous as Distribution).targets.map(t => t.contact).filter(Boolean))
      return {
        ...(revised as Distribution),
        targets: (revised as Distribution).targets.map(t => (t.contact && !found.has(t.contact) ? { ...t, contact: null } : t)),
      }
    },
  },

  creative: {
    schema: CreativeSchema,
    summarize: d => clip(JSON.stringify(d), 6000),
    checks: () => [],
    persist: async (brain, data, runId) => {
      await saveOutput({ runId, productId: brain.product.id, agent: 'creative', outputType: 'visual_system', content: data })
    },
  },

  pr: {
    schema: PRSchema,
    summarize: d => clip(JSON.stringify(d), 9000),
    checks: d => {
      const gap = findPlaceholder(JSON.stringify(d))
      return gap ? [mustFix(`The press materials contain the placeholder ${gap}.`, 'Replace it with real text or remove it.')] : []
    },
    persist: async (brain, data, runId) => {
      await saveOutput({ runId, productId: brain.product.id, agent: 'pr', outputType: 'launch_pr', content: data })
    },
  },

  ads: {
    schema: AdsSchema,
    summarize: d => clip(JSON.stringify(d), 8000),
    checks: (d, brain) => {
      const ads = d as Ads
      const budget = adBudget(brain.product)
      const currency = currencyFor(brain.product)
      const total = ads.campaigns.reduce((sum, c) => sum + (Number(c.monthly_budget) || 0), 0)
      const issues: Issue[] = []
      if (total > budget * 1.001) issues.push(mustFix(`Campaigns add up to ${total} ${ads.currency} but the budget is ${budget} ${currency}.`, `Reduce the campaign budgets to total at most ${budget}.`))
      if (ads.currency.toUpperCase() !== currency) issues.push(mustFix(`Budgets are in ${ads.currency}, but this product's currency is ${currency}.`, `Express every amount in ${currency}.`))
      return issues
    },
    persist: async (brain, data, runId) => {
      await saveOutput({ runId, productId: brain.product.id, agent: 'ads', outputType: 'ad_campaigns', content: data })
    },
  },

  investor: {
    schema: InvestorSchema,
    summarize: d => clip(JSON.stringify(d), 8000),
    checks: () => [],
    persist: async (brain, data, runId, sources) => {
      await saveOutput({ runId, productId: brain.product.id, agent: 'investor', outputType: 'fundraising_brief', content: data, sources })
    },
  },
}

const REVIEW_SYSTEM = `${CHARTER}

You are ARIA, the marketing director of a small team working for a solo founder.
You review your team's work before the founder sees it. Be strict about what matters and ignore style nitpicks.
Mark something must_fix only if it would embarrass the founder or mislead someone:
- It contradicts the approved strategy, positioning or voice rules, or breaks a house rule.
- It states a fact about the product, a number, or a claim that the brief doesn't support.
- It is generic filler that could be about any product.
- It is incomplete or not ready to use (missing parts, template gaps).
Use should_fix for improvements that are worth making but not required.
Verdict "revise" only if there is at least one must_fix issue; otherwise "pass".
Give each fix as a concrete instruction the agent can follow.`

export interface ReviewOutcome {
  agent: AgentKey
  verdict: 'pass' | 'revise'
  issues: Issue[]
  revised: boolean
  error?: string
}

/**
 * Review each agent's current output from this run and revise the ones that
 * fail. Returns what happened per agent, for the run's warnings and the UI.
 */
export async function reviewAndRevise(
  ctxFor: (agent: AgentKey) => CallContext,
  brain: Brain,
  runId: string,
  agents: AgentKey[],
): Promise<ReviewOutcome[]> {
  const supabase = db()
  const productId = brain.product.id
  const brief = renderBrief(brain)
  const outcomes: ReviewOutcome[] = []

  for (const agent of agents) {
    const spec = REVIEWABLE[agent]
    if (!spec) continue
    const { data: row } = await supabase.from('agent_outputs')
      .select('id, content_json, sources').eq('product_id', productId).eq('agent_name', agent)
      .eq('run_id', runId).eq('status', 'current').order('version', { ascending: false }).limit(1).maybeSingle()
    if (!row) continue

    const parsed = spec.schema.safeParse(row.content_json)
    if (!parsed.success) continue
    const current = parsed.data

    // 1. What code can prove.
    const found = spec.checks(current, brain)

    // 2. What needs judgement.
    const { data: notes } = await generateObject(ctxFor('director'), {
      system: REVIEW_SYSTEM,
      schema: ReviewNotesSchema,
      maxOutputTokens: 3000,
      purpose: `review:${agent}`,
      prompt: `${brief}

## WORK TO REVIEW — ${AGENTS[agent].name} (${AGENTS[agent].title})
${spec.summarize(current)}
${found.length ? `\n## ALREADY FOUND BY AUTOMATIC CHECKS (include these as must_fix)\n${found.map(i => `- ${i.problem}`).join('\n')}` : ''}

Review this work against the brief. Return your verdict and issues.`,
    })

    // Never let the model wave through something code proved is broken.
    const issues = mergeIssues(found, notes.issues)
    const verdict: 'pass' | 'revise' = issues.some(i => i.severity === 'must_fix') ? 'revise' : 'pass'
    const outcome: ReviewOutcome = { agent, verdict, issues, revised: false }

    // 3. One targeted revision.
    if (verdict === 'revise') {
      try {
        await revise(ctxFor(agent), brain, agent, spec, current, issues, runId, (row.sources ?? []) as Source[])
        outcome.revised = true
      } catch (err) {
        outcome.error = (err as Error).message
      }
    }

    await supabase.from('agent_reviews').insert({
      run_id: runId, product_id: productId, agent, verdict, issues, revised: outcome.revised, revision_error: outcome.error ?? null,
    })
    outcomes.push(outcome)
  }
  return outcomes
}

function mergeIssues(found: Issue[], judged: Issue[]): Issue[] {
  const seen = new Set(found.map(i => i.problem.toLowerCase()))
  return [...found, ...judged.filter(i => !seen.has(i.problem.toLowerCase()))]
}

async function revise<T>(
  ctx: CallContext, brain: Brain, agent: AgentKey, spec: Reviewable<T>, current: T,
  issues: Issue[], runId: string, sources: Source[],
) {
  const { data } = await generateObject(ctx, {
    system: `${CHARTER}\n\nYou are ${AGENTS[agent].name}, ${AGENTS[agent].title} on a small marketing team.
ARIA, your director, reviewed your work. Apply every must_fix note exactly, apply should_fix notes where sensible,
and keep everything else as it was. Return the complete revised work in the same structure.
Do not add new facts, contacts, sources or URLs that are not in your previous version or the brief.`,
    schema: spec.schema,
    maxOutputTokens: agent === 'content' ? 24000 : 10000,
    purpose: `revise:${agent}`,
    prompt: `${renderBrief(brain)}

## YOUR PREVIOUS WORK
${JSON.stringify(current)}

## ARIA'S NOTES
${issues.map(i => `- [${i.severity}] ${i.problem} → ${i.fix}`).join('\n')}`,
  })

  let revised = spec.guard ? spec.guard(data, current) : data
  // A revision may only cite pages that were really retrieved for this product.
  revised = verifySources(revised, await knownSources(brain.product.id)).data
  await spec.persist(brain, revised, runId, sources)
}
