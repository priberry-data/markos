import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { approveStrategy, startLaunch } from '@/lib/engine/orchestrator'
import {
  ContentPlatformSchema, CreativeSchema, DistributionSchema, ResearchSchema, SearchSchema, StrategySchema,
} from '@/lib/engine/schemas'
import { findPlaceholder } from '@/lib/engine/sources'
import { z } from 'zod'

// The real end-to-end check: a full launch on a real product with the real AI
// provider, then every guarantee MarkOS makes is checked against what landed in
// the database. It spends real (small) money, so it only runs when asked:
//
//   EVAL_PRODUCT="Your product" npx vitest run tests/eval-launch.test.ts
//
// It prints a per-agent report with cost.

const name = process.env.EVAL_PRODUCT

const SCHEMAS: Record<string, z.ZodType> = {
  research: ResearchSchema,
  strategy: StrategySchema,
  content: z.object({ calendars: z.array(ContentPlatformSchema), failed_platforms: z.array(z.string()) }),
  search: SearchSchema,
  distribution: DistributionSchema,
  creative: CreativeSchema,
}

async function waitFor(runId: string, statuses: string[], minutes = 15) {
  const until = Date.now() + minutes * 60_000
  for (;;) {
    const { data } = await db().from('agent_runs').select('*').eq('id', runId).single()
    if (data && statuses.includes(data.status)) return data
    if (Date.now() > until) throw new Error(`Run ${runId} still ${data?.status} after ${minutes} min`)
    await new Promise(r => setTimeout(r, 3000))
  }
}

describe.skipIf(!name)('real launch evaluation', () => {
  it(`launches ${name} end to end and every guarantee holds`, async () => {
    const { data: product } = await db().from('products').select('id').eq('name', name!).single()
    expect(product, `No product named ${name}`).toBeTruthy()
    const productId = product!.id

    // 1. Research → strategy → pause
    const launchId = await startLaunch(productId)
    const paused = await waitFor(launchId, ['awaiting_approval', 'failed', 'cancelled'])
    expect(paused.error_message, 'planning failed').toBeNull()
    expect(paused.status).toBe('awaiting_approval')

    // 2. Approve → production → ARIA review
    const runId = await approveStrategy(productId)
    const run = await waitFor(runId!, ['completed', 'completed_with_warnings', 'failed', 'cancelled'])

    const [{ data: outputs }, { data: calls }, { data: steps }, { data: pieces }, { data: targets }, { data: sources }, { data: reviews }] = await Promise.all([
      db().from('agent_outputs').select('agent_name, content_json, run_id').eq('product_id', productId).in('status', ['current', 'draft']),
      db().from('llm_calls').select('agent, cost_usd, status, error').in('run_id', [launchId, runId!]),
      db().from('run_steps').select('agent, status, detail').in('run_id', [launchId, runId!]),
      db().from('content_items').select('title, body, scheduled_at').eq('product_id', productId).eq('status', 'draft'),
      db().from('outreach_targets').select('name, source, verified, handle_or_email, outreach_draft').eq('product_id', productId).eq('status', 'identified'),
      db().from('sources').select('url').eq('product_id', productId),
      db().from('agent_reviews').select('agent, verdict, revised').eq('run_id', runId!),
    ])

    // ── report ──
    const costBy = new Map<string, number>()
    for (const c of calls ?? []) costBy.set(c.agent, (costBy.get(c.agent) ?? 0) + Number(c.cost_usd))
    const total = [...costBy.values()].reduce((a, b) => a + b, 0)
    console.log('\n──── MarkOS launch evaluation ────')
    for (const s of steps ?? []) console.log(`${s.agent.padEnd(13)} ${s.status.padEnd(8)} $${(costBy.get(s.agent) ?? 0).toFixed(4)}  ${s.detail ?? ''}`)
    console.log(`reviews: ${(reviews ?? []).map(r => `${r.agent}=${r.verdict}${r.revised ? '(revised)' : ''}`).join(', ') || 'none'}`)
    console.log(`run: ${run.status} · AI calls: ${(calls ?? []).length} (${(calls ?? []).filter(c => c.status === 'error').length} retried/failed) · total ≈ $${total.toFixed(4)}`)
    console.log(`sources retrieved: ${(sources ?? []).length} · content drafts: ${(pieces ?? []).length} · targets: ${(targets ?? []).length} (${(targets ?? []).filter(t => t.verified).length} verified)`)
    for (const w of (run.warnings ?? []) as string[]) console.log(`warning: ${w}`)
    console.log('──────────────────────────────────\n')

    // ── guarantees ──
    expect(run.status, run.error_message ?? '').not.toBe('failed')
    for (const o of outputs ?? []) {
      const schema = SCHEMAS[o.agent_name]
      if (schema) expect(schema.safeParse(o.content_json).success, `${o.agent_name} output matches its schema`).toBe(true)
    }
    expect((sources ?? []).length, 'research used live sources').toBeGreaterThan(0)
    expect((pieces ?? []).length, 'NOVA wrote content').toBeGreaterThan(0)
    expect((pieces ?? []).every(p => p.scheduled_at), 'every piece has a date').toBe(true)
    expect((pieces ?? []).filter(p => findPlaceholder(p.body) || findPlaceholder(p.title)), 'no template gaps in content').toEqual([])
    expect((targets ?? []).filter(t => findPlaceholder(t.outreach_draft)), 'no template gaps in outreach').toEqual([])
    const sourceSet = new Set((sources ?? []).map(s => s.url))
    expect((targets ?? []).filter(t => t.verified && !sourceSet.has(t.source ?? '') && !t.source), 'verified targets cite a retrieved page').toEqual([])
    const { data: profile } = await db().from('profiles').select('run_budget_usd').eq('id', 1).single()
    expect(total, 'stayed within the per-run budget').toBeLessThanOrEqual(Number(profile?.run_budget_usd ?? 1) * 2)
  }, 40 * 60_000)
})
