import { describe, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import { approveStrategy, startLaunch } from '@/lib/engine/orchestrator'
import { CREATIVE, DISTRIBUTION, RESEARCH, SEARCH, SOURCES, STRATEGY, contentFor } from './fixtures'

// Not a test: fills a real product with sample output from the real engine
// (fake AI), so the UI can be checked without spending on a provider.
// Run with: PREVIEW_PRODUCT="Your product" npx vitest run tests/preview-seed.test.ts
const name = process.env.PREVIEW_PRODUCT

vi.mock('@/lib/api/firecrawl', () => ({
  scrapeUrl: async () => ({ title: 'T', description: 'D', content: 'Turns real work into verified proof of skill. '.repeat(10), url: 'https://example.test' }),
}))

describe.skipIf(!name)('preview seed', () => {
  it('runs the engine with sample output', async () => {
    const { data: product } = await db().from('products').select('id').eq('name', name!).single()
    const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
    setFakeHandler(req => {
      if (req.system.includes('ARIA, your director')) return { text: JSON.stringify({ ...DISTRIBUTION, targets: DISTRIBUTION.targets.map(t => ({ ...t, draft_message: t.draft_message.replace('Hi [Name], ', 'Hi there, ') })) }) }
      if (req.system.includes('You are ARIA')) return { text: JSON.stringify({ verdict: 'pass', issues: [] }) }
      if (req.grounded) return { text: 'Notes [1][2].', sources: SOURCES }
      if (req.system.includes('REX')) return { text: JSON.stringify(RESEARCH) }
      if (req.system.includes('SAGE')) return { text: JSON.stringify(STRATEGY) }
      if (req.system.includes('NOVA')) return { text: JSON.stringify(contentFor((req.prompt.match(/Set "platform" to "(\w+)"/)?.[1] ?? 'linkedin') as 'linkedin')) }
      if (req.system.includes('QUINN')) return { text: JSON.stringify(SEARCH) }
      if (req.system.includes('REACH')) return { text: JSON.stringify(DISTRIBUTION) }
      if (req.system.includes('PIXEL')) return { text: JSON.stringify(CREATIVE) }
      return { text: '{}' }
    })
    try {
      const wait = async (id: string, s: string[]) => {
        for (;;) {
          const { data } = await db().from('agent_runs').select('status').eq('id', id).single()
          if (s.includes(data!.status)) return
          await new Promise(r => setTimeout(r, 200))
        }
      }
      const launch = await startLaunch(product!.id)
      await wait(launch, ['awaiting_approval', 'failed'])
      const run = await approveStrategy(product!.id)
      await wait(run!, ['completed', 'completed_with_warnings', 'failed'])
    } finally {
    }
  }, 60_000)
})
