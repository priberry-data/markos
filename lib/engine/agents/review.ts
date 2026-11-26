import { db } from '@/lib/db'
import { CHARTER } from '../charter'
import { generateObject, type CallContext } from '@/lib/llm'
import { renderBrief, type Brain } from '../brain'
import { WeeklyReviewSchema } from '../schemas'
import { saveOutput } from '../store'

// PULSE — the weekly review, from real numbers only.
//
// The old analytics agent was never given any data, so every report was
// "simulated"; the old feedback agent saw only approval statuses with no
// reasons, and its output fed nothing. PULSE uses what MarkOS actually knows —
// what the founder approved, rejected (and why), edited, posted, who replied —
// plus any numbers the founder enters. Its proposed strategy changes become a
// strategy revision the founder approves, so the loop actually closes.

const DAY = 24 * 3600 * 1000

export interface WeeklyMetrics {
  period: { from: string; to: string }
  content: { drafted: number; approved: number; posted: number; rejected: number; edited: number; byPlatformPosted: Record<string, number> }
  rejectionReasons: string[]
  outreach: { found: number; contacted: number; replied: number; inTalks: number; won: number; notAFit: number }
  houseRules: string[]
  founderNumbers: Array<{ metric: string; value: number; note: string | null; recorded_for: string }>
  aiCostUsd: number
}

export async function gatherMetrics(productId: string, days = 7): Promise<WeeklyMetrics> {
  const supabase = db()
  const to = new Date()
  const from = new Date(to.getTime() - days * DAY)
  const since = from.toISOString()

  const [{ data: items }, { data: targets }, { data: rules }, { data: numbers }, { data: calls }] = await Promise.all([
    supabase.from('content_items').select('platform, status, edited, rejected_reason, updated_at, created_at').eq('product_id', productId).gte('updated_at', since),
    supabase.from('outreach_targets').select('status, updated_at').eq('product_id', productId).neq('status', 'superseded'),
    supabase.from('house_rules').select('rule').eq('product_id', productId).eq('active', true),
    supabase.from('metric_entries').select('metric, value, note, recorded_for').eq('product_id', productId).gte('recorded_for', since.slice(0, 10)).order('recorded_for'),
    supabase.from('llm_calls').select('cost_usd').eq('product_id', productId).gte('created_at', since),
  ])

  const c = items ?? []
  const byPlatformPosted: Record<string, number> = {}
  for (const i of c) if (i.status === 'posted') byPlatformPosted[i.platform] = (byPlatformPosted[i.platform] ?? 0) + 1
  const t = targets ?? []
  const count = (s: string) => t.filter(x => x.status === s).length

  return {
    period: { from: since.slice(0, 10), to: to.toISOString().slice(0, 10) },
    content: {
      drafted: c.filter(i => i.created_at >= since).length,
      approved: c.filter(i => i.status === 'approved').length,
      posted: c.filter(i => i.status === 'posted').length,
      rejected: c.filter(i => i.status === 'rejected').length,
      edited: c.filter(i => i.edited).length,
      byPlatformPosted,
    },
    rejectionReasons: c.map(i => i.rejected_reason).filter(Boolean) as string[],
    outreach: {
      found: t.length,
      contacted: count('contacted') + count('replied') + count('in_talks') + count('closed'),
      replied: count('replied') + count('in_talks') + count('closed'),
      inTalks: count('in_talks'),
      won: count('closed'),
      notAFit: count('not_a_fit'),
    },
    houseRules: (rules ?? []).map(r => r.rule as string),
    founderNumbers: (numbers ?? []).map(n => ({ metric: n.metric, value: Number(n.value), note: n.note, recorded_for: n.recorded_for })),
    aiCostUsd: (calls ?? []).reduce((s, x) => s + Number(x.cost_usd ?? 0), 0),
  }
}

const SYSTEM = `${CHARTER}

You are PULSE, who runs the weekly review for a solo founder's marketing.
Rules:
- Use ONLY the numbers and facts given. Never invent traffic, engagement, conversion or revenue figures.
- If there is too little activity to judge, say so plainly and focus on what to do so next week produces a signal.
- Read the founder's rejections and edits as feedback about taste and direction.
- Recommendations must be specific actions for next week.
- Propose strategy changes only when the evidence supports them; each needs a reason tied to the data.`

export async function runWeeklyReview(ctx: CallContext, brain: Brain, opts: { runId: string | null }) {
  const metrics = await gatherMetrics(brain.product.id)
  const { data } = await generateObject(ctx, {
    system: SYSTEM,
    schema: WeeklyReviewSchema,
    maxOutputTokens: 5000,
    prompt: `${renderBrief(brain)}

## WHAT ACTUALLY HAPPENED (${metrics.period.from} → ${metrics.period.to})
${JSON.stringify(metrics, null, 1)}

## YOUR TASK
Review the week against the approved strategy and its plan. What worked, what didn't, what to do next week, and any strategy changes the evidence supports.`,
  })
  const saved = await saveOutput({
    runId: opts.runId, productId: brain.product.id, agent: 'review', outputType: 'weekly_review',
    content: { ...data, metrics },
  })
  return { outputId: saved.id, changes: data.strategy_changes.length }
}
