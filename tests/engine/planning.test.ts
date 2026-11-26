import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import { approveStrategy, cancelRun, startLaunch } from '@/lib/engine/orchestrator'
import type { ProviderRequest } from '@/lib/llm/types'
import { RESEARCH, SOURCES, STRATEGY } from '../fixtures'

// Integration test: the real local database, the real engine, a fake AI.
vi.mock('@/lib/api/firecrawl', () => ({
  scrapeUrl: async () => ({ title: 'Test product', description: 'A test', content: 'Turns real work into verified proof of skill. '.repeat(10), url: 'https://example.test' }),
}))

let productId: string
let savedModels: unknown

async function waitForRun(runId: string, statuses: string[], timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const { data } = await db().from('agent_runs').select('*').eq('id', runId).single()
    if (data && statuses.includes(data.status)) return data
    if (Date.now() > until) throw new Error(`run stayed ${data?.status}`)
    await new Promise(r => setTimeout(r, 100))
  }
}

function fakeAgents(req: ProviderRequest) {
  if (req.grounded) return { text: 'Rival charges ₹999/mo [1]. People say resumes are ignored [2].', sources: SOURCES }
  if (req.system.includes('REX')) return { text: JSON.stringify(RESEARCH) }
  if (req.system.includes('SAGE')) return { text: JSON.stringify(STRATEGY) }
  return { text: '{}' }
}

beforeAll(async () => {
  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  savedModels = profile?.agent_models ?? {}
  const { data } = await db().from('products').insert({ name: 'Engine test product', url: 'https://example.test' }).select('id').single()
  productId = data!.id
})

afterAll(async () => {
  await db().from('products').delete().eq('id', productId)
})

beforeEach(() => setFakeHandler(fakeAgents))

describe('planning phase', () => {
  it('researches, drafts a strategy, then pauses for approval', async () => {
    const runId = await startLaunch(productId)
    const run = await waitForRun(runId, ['awaiting_approval', 'failed'])
    expect(run.error_message).toBeNull()
    expect(run.status).toBe('awaiting_approval')

    const { data: brain } = await db().from('product_brains').select('*').eq('product_id', productId).single()
    expect(brain.strategy_status).toBe('draft')
    expect(brain.strategy.tagline).toBe('Proof, not promises.')

    // The invented citation was removed; the real ones survived.
    const pains = brain.research.audience.pain_points
    expect(pains.find((p: { point: string }) => p.point === 'Invented claim').source).toBeNull()
    expect(pains.find((p: { point: string }) => p.point === 'Resumes are ignored').source).toBe(SOURCES[1].url)

    const { data: sources } = await db().from('sources').select('url').eq('product_id', productId)
    expect(sources!.map(s => s.url).sort()).toEqual(SOURCES.map(s => s.url).sort())

    const { data: steps } = await db().from('run_steps').select('agent, status').eq('run_id', runId)
    expect(Object.fromEntries(steps!.map(s => [s.agent, s.status]))).toEqual({ research: 'done', strategy: 'done' })

    const { count } = await db().from('llm_calls').select('id', { count: 'exact', head: true }).eq('run_id', runId)
    expect(count).toBeGreaterThanOrEqual(3) // search + shape + strategy
  })

  it('continues from the approved (edited) strategy', async () => {
    const edited = { ...STRATEGY, tagline: 'Edited by the founder' }
    const runId = await approveStrategy(productId, edited)
    expect(runId).toBeTruthy()
    await waitForRun(runId!, ['completed', 'completed_with_warnings', 'failed'])

    const { data: brain } = await db().from('product_brains').select('strategy, strategy_status').eq('product_id', productId).single()
    expect(brain!.strategy_status).toBe('approved')
    expect(brain!.strategy.tagline).toBe('Edited by the founder')
  })

  it('re-running supersedes the old version instead of duplicating it', async () => {
    const runId = await startLaunch(productId)
    await waitForRun(runId, ['awaiting_approval', 'failed'])
    const { data: outputs } = await db().from('agent_outputs')
      .select('status, version').eq('product_id', productId).eq('agent_name', 'research').order('version')
    expect(outputs!.map(o => o.status)).toEqual(['superseded', 'current'])
    expect(outputs!.map(o => o.version)).toEqual([1, 2])
  })

  it('Stop aborts in-flight work and the run can never show completed', async () => {
    setFakeHandler(async req => {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 2000)
        req.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) })
      })
      return fakeAgents(req)
    })
    const runId = await startLaunch(productId)
    await new Promise(r => setTimeout(r, 300))
    await cancelRun(runId)
    await new Promise(r => setTimeout(r, 2500))
    const { data: run } = await db().from('agent_runs').select('status').eq('id', runId).single()
    expect(run!.status).toBe('cancelled')
  })

  it('a new launch replaces a paused one', async () => {
    const first = await startLaunch(productId)
    await waitForRun(first, ['awaiting_approval'])
    const second = await startLaunch(productId)
    const { data: old } = await db().from('agent_runs').select('status, error_message').eq('id', first).single()
    expect(old!.status).toBe('cancelled')
    await waitForRun(second, ['awaiting_approval'])
  })
})
