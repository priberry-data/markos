import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { GET } from '@/app/api/pulse/route'

// The browser's live updates poll /api/pulse instead of holding a database connection.
// These check it reports new notifications and notices when a run's step changes.

let productId = ''
// A cursor from before the test; the database's clock may differ from this machine's.
const startedAt = new Date(Date.now() - 10 * 60_000).toISOString()
const pulse = async (q: string) => (await GET(new Request(`http://localhost/api/pulse?${q}`))).json()

beforeAll(async () => {
  const { data, error } = await db().from('products').insert({ name: 'TEST: pulse', url: 'https://pulse.example.test' }).select('id').single()
  if (error) throw error
  productId = data.id
})

afterAll(async () => {
  await db().from('notifications').delete().like('title', 'TEST: pulse%')
  await db().from('products').delete().eq('id', productId)
})

describe('pulse', () => {
  it('returns notifications created after `since`, newest first', async () => {
    await db().from('notifications').insert({ type: 'agent_complete', title: 'TEST: pulse one', message: '' })
    const res = await pulse(`since=${encodeURIComponent(startedAt)}`)
    expect(res.notifications.map((n: { title: string }) => n.title)).toContain('TEST: pulse one')
    const newest = res.notifications[0].created_at
    const later = await pulse(`since=${encodeURIComponent(newest)}`)
    expect(later.notifications.map((n: { title: string }) => n.title)).not.toContain('TEST: pulse one')
  })

  it('changes the run fingerprint when a step starts or finishes, and only then', async () => {
    const first = (await pulse(`productId=${productId}`)).runs
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect((await pulse(`productId=${productId}`)).runs).toBe(first)

    const { data: run } = await db().from('agent_runs').insert({ product_id: productId, run_type: 'test' }).select('id').single()
    const withRun = (await pulse(`productId=${productId}`)).runs
    expect(withRun).not.toBe(first)

    const { data: step } = await db().from('run_steps').insert({ run_id: run!.id, product_id: productId, agent: 'rex' }).select('id').single()
    const queued = (await pulse(`productId=${productId}`)).runs
    expect(queued).not.toBe(withRun)

    await db().from('run_steps').update({ status: 'done', started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).eq('id', step!.id)
    expect((await pulse(`productId=${productId}`)).runs).not.toBe(queued)
  })

  it('ignores a malformed product id instead of querying with it', async () => {
    const res = await pulse('productId=not-a-uuid')
    expect(res.runs).toBeUndefined()
  })
})
