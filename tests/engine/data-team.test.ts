import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import type { ProviderRequest } from '@/lib/llm/types'
import { analyseWithData } from '@/lib/engine/execs/data-team'

// The Data team end to end, using the local database as the "product
// database": real read-only queries, a fake AI that also tries to invent a
// number — which must not survive.

const NAME = 'Data test product'
let productId: string
let savedModels: unknown
const props = (req: ProviderRequest) => Object.keys((req.jsonSchema?.properties ?? {}) as object)

beforeAll(async () => {
  process.env.DATA_URL_DATA_TEST_PRODUCT = process.env.MARKOS_TEST_DB_URL!
  const { data: p } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  savedModels = p?.agent_models ?? {}
  const { data } = await db().from('products').insert({ name: NAME, url: 'https://data.test', night_enabled: false }).select('id').single()
  productId = data!.id
  setFakeHandler(req => {
    const k = props(req)
    if (k.includes('queries')) {
      return { text: JSON.stringify({ queries: [
        { purpose: 'products in the portfolio', sql: 'select count(*)::int as products from products' },
        { purpose: 'sneaky write', sql: 'delete from products' },
      ] }) }
    }
    if (k.includes('answer')) {
      const n = Number(/products\n(\d+)/.exec(req.prompt)?.[1])
      return { text: JSON.stringify({
        answer: `There are ${n} products.`,
        metrics: [
          { name: 'products in the portfolio', value: n, unit: null, basis: 'products in the portfolio' },
          { name: 'revenue this month', value: 987654, unit: 'INR', basis: 'made up' },
        ],
        findings: [], data_quality: [], caveats: [],
      }) }
    }
    return { text: '{}' }
  })
})

afterAll(async () => {
  await db().from('products').delete().eq('id', productId)
  delete process.env.DATA_URL_DATA_TEST_PRODUCT
})

describe('the Data team', () => {
  it('answers from real queries, refuses writes, and blanks invented numbers', async () => {
    const before = await db().from('products').select('id', { count: 'exact', head: true })
    const a = await analyseWithData(productId, 'How many products are there?')
    expect(a.connected).toBe(true)
    const real = a.metrics.find(m => m.name === 'products in the portfolio')!
    expect(real.value).toBe(before.count)
    expect(a.metrics.find(m => m.name === 'revenue this month')!.value).toBeNull()   // not in any result
    expect(a.queries.find(q => q.purpose === 'sneaky write')!.error).toMatch(/Not run/)
    const after = await db().from('products').select('id', { count: 'exact', head: true })
    expect(after.count).toBe(before.count)                                            // nothing was deleted

    const { data: saved } = await db().from('metric_entries').select('metric, value, note').eq('product_id', productId)
    expect(saved).toEqual([{ metric: 'products in the portfolio', value: before.count, note: 'Data team · products in the portfolio' }])
  })

  it('says plainly when a product isn’t connected', async () => {
    delete process.env.DATA_URL_DATA_TEST_PRODUCT
    const a = await analyseWithData(productId, 'anything')
    expect(a.connected).toBe(false)
    expect(a.answer).toMatch(/DATA_URL_DATA_TEST_PRODUCT/)
    process.env.DATA_URL_DATA_TEST_PRODUCT = process.env.MARKOS_TEST_DB_URL!
  })
})
