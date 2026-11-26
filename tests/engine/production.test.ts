import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import { ProviderError } from '@/lib/llm/types'
import { approveStrategy, startAgentRun, startLaunch } from '@/lib/engine/orchestrator'
import type { ProviderRequest } from '@/lib/llm/types'
import { CREATIVE, DISTRIBUTION, RESEARCH, SEARCH, SOURCES, STRATEGY, contentFor } from '../fixtures'

vi.mock('@/lib/api/firecrawl', () => ({
  scrapeUrl: async () => ({ title: 'T', description: 'D', content: 'Turns real work into verified proof of skill. '.repeat(10), url: 'https://example.test' }),
}))

let productId: string
let savedModels: unknown
let failSearch = false

async function waitForRun(runId: string, statuses: string[], timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const { data } = await db().from('agent_runs').select('*').eq('id', runId).single()
    if (data && statuses.includes(data.status)) return data
    if (Date.now() > until) throw new Error(`run stayed ${data?.status}: ${data?.error_message}`)
    await new Promise(r => setTimeout(r, 100))
  }
}

function fakeAgents(req: ProviderRequest) {
  // ARIA's revision request to an agent — check before the plain agent names.
  if (req.system.includes('ARIA, your director')) {
    if (req.system.includes('REACH')) {
      const fixed = {
        ...DISTRIBUTION,
        targets: DISTRIBUTION.targets.map(t => ({
          ...t,
          draft_message: t.draft_message.replace('Hi [Name], ', 'Hi there, '),
          // The revision tries to sneak in a contact the research never found.
          contact: t.name === 'r/jobs' ? 'mods@invented.example' : t.contact,
        })),
      }
      return { text: JSON.stringify(fixed) }
    }
    return { text: '{}' }
  }
  // ARIA's review: the model waves everything through...
  if (req.system.includes('You are ARIA')) return { text: JSON.stringify({ verdict: 'pass', issues: [] }) }
  if (req.system.includes('QUINN') && failSearch) throw new ProviderError('bad', 'bad_request', 400)
  if (req.grounded) {
    // REACH's notes mention a real public contact page but not the invented email.
    return { text: 'r/jobs is active [2]. Rival pricing [1]. Contact: hello@rival.test', sources: SOURCES }
  }
  if (req.system.includes('REX')) return { text: JSON.stringify(RESEARCH) }
  if (req.system.includes('SAGE')) return { text: JSON.stringify(STRATEGY) }
  if (req.system.includes('NOVA')) {
    const platform = (req.prompt.match(/Set "platform" to "(\w+)"/)?.[1] ?? 'linkedin') as 'linkedin'
    return { text: JSON.stringify(contentFor(platform)) }
  }
  if (req.system.includes('QUINN')) return { text: JSON.stringify(SEARCH) }
  if (req.system.includes('REACH')) return { text: JSON.stringify(DISTRIBUTION) }
  if (req.system.includes('PIXEL')) return { text: JSON.stringify(CREATIVE) }
  if (req.system.includes('PULSE')) {
    // PULSE must be given the real activity, including the founder's rejection reason.
    if (!req.prompt.includes('"rejectionReasons"')) throw new Error('PULSE was not given the metrics')
    return { text: JSON.stringify({ summary: 'Quiet week', what_worked: [], what_didnt: ['Nothing posted'], recommendations: [{ change: 'Post twice', why: 'No signal yet' }], strategy_changes: [] }) }
  }
  return { text: '{}' }
}

beforeAll(async () => {
  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  savedModels = profile?.agent_models ?? {}
  const { data } = await db().from('products').insert({ name: 'Production test', url: 'https://example.test', target_geography: 'India' }).select('id').single()
  productId = data!.id
})

afterAll(async () => {
  await db().from('products').delete().eq('id', productId)
})

beforeEach(() => { failSearch = false; setFakeHandler(fakeAgents) })

describe('production phase', () => {
  it('runs the relevant agents after approval and skips the rest with a reason', async () => {
    const launch = await startLaunch(productId)
    await waitForRun(launch, ['awaiting_approval'])
    const runId = await approveStrategy(productId)
    const run = await waitForRun(runId!, ['completed', 'completed_with_warnings', 'failed'])
    expect(run.status).not.toBe('failed')

    const { data: steps } = await db().from('run_steps').select('agent, status, detail').eq('run_id', runId!)
    const byAgent = Object.fromEntries(steps!.map(s => [s.agent, s]))
    for (const a of ['content', 'search', 'distribution', 'creative']) expect(byAgent[a].status).toBe('done')
    expect(byAgent.ads).toMatchObject({ status: 'skipped', detail: 'No ad budget set' })
    expect(byAgent.investor.status).toBe('skipped')
    expect(byAgent.pr.status).toBe('skipped')
  })

  it('gives every content piece a real date', async () => {
    const { data: items } = await db().from('content_items').select('scheduled_at, status, platform').eq('product_id', productId).eq('status', 'draft')
    expect(items!.length).toBeGreaterThan(0)
    expect(items!.every(i => i.scheduled_at)).toBe(true)
  })

  it('keeps sourced keywords with their stated volume', async () => {
    const { data } = await db().from('seo_data').select('keyword, search_volume, source').eq('product_id', productId).eq('status', 'current')
    expect(data).toHaveLength(2)
    expect(data!.find(k => k.keyword === 'how to prove skills to employers')!.search_volume).toBe('1K–10K/month')
  })

  it('drops invented contacts and citations', async () => {
    const { data: targets } = await db().from('outreach_targets').select('name, handle_or_email, verified, source').eq('product_id', productId).neq('status', 'superseded')
    const coach = targets!.find(t => t.name === 'Career coach')!
    expect(coach.handle_or_email).toBeNull()   // invented email removed
    expect(coach.verified).toBe(false)          // invented source removed
    expect(targets!.find(t => t.name === 'r/jobs')!.verified).toBe(true)
  })

  it("ARIA sends back work with a [Name] gap even when the model says it's fine", async () => {
    const { data: review } = await db().from('agent_reviews').select('verdict, revised, issues').eq('product_id', productId).eq('agent', 'distribution').single()
    expect(review).toMatchObject({ verdict: 'revise', revised: true })
    expect(JSON.stringify(review!.issues)).toContain('[Name]')

    const { data: targets } = await db().from('outreach_targets').select('name, outreach_draft, handle_or_email').eq('product_id', productId).neq('status', 'superseded')
    expect(targets!.find(t => t.name === 'Career coach')!.outreach_draft).not.toContain('[Name]')
    // The revision could not introduce a contact the research never found.
    expect(targets!.find(t => t.name === 'r/jobs')!.handle_or_email).toBeNull()

    // Warnings describe the final state: the fixed placeholder isn't reported, the removed contact is.
    const { data: run } = await db().from('agent_runs').select('warnings').eq('product_id', productId).eq('run_type', 'launch').order('started_at', { ascending: false }).limit(1).single()
    const warnings = (run!.warnings as string[]).join(' | ')
    expect(warnings).toContain("didn't appear in any page")
    expect(warnings).not.toContain('[placeholder]')
  })

  it("one agent failing doesn't discard the others' work", async () => {
    failSearch = true
    const runId = await startAgentRun(productId, 'search')
    const run = await waitForRun(runId, ['completed', 'completed_with_warnings', 'failed'])
    expect(run.status).toBe('failed') // the only agent in this run failed
    // ...but the previous keywords are still there.
    const { count } = await db().from('seo_data').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('status', 'current')
    expect(count).toBe(2)
  })

  it('re-running NOVA supersedes untouched drafts but keeps edited ones', async () => {
    const { data: one } = await db().from('content_items').select('id').eq('product_id', productId).eq('status', 'draft').limit(1).single()
    await db().from('content_items').update({ edited: true, body: 'My own words' }).eq('id', one!.id)

    const runId = await startAgentRun(productId, 'content')
    await waitForRun(runId, ['completed', 'completed_with_warnings'])

    const { data: kept } = await db().from('content_items').select('status, body').eq('id', one!.id).single()
    expect(kept).toMatchObject({ status: 'draft', body: 'My own words' })
    const { count: superseded } = await db().from('content_items').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('status', 'superseded')
    expect(superseded).toBeGreaterThan(0)
  })

  it('PULSE reviews the week from real activity, including rejection reasons', async () => {
    const { data: piece } = await db().from('content_items').select('id').eq('product_id', productId).eq('status', 'draft').limit(1).single()
    await db().from('content_items').update({ status: 'rejected', rejected_reason: 'too corporate' }).eq('id', piece!.id)
    const runId = await startAgentRun(productId, 'review')
    const run = await waitForRun(runId, ['completed', 'failed'])
    expect(run.status).toBe('completed')
    const { data: out } = await db().from('agent_outputs').select('content_json').eq('product_id', productId).eq('agent_name', 'review').eq('status', 'current').single()
    expect(out!.content_json.summary).toBe('Quiet week')
    expect(out!.content_json.metrics.rejectionReasons).toContain('too corporate')
  })
})
