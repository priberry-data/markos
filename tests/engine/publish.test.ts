import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { publishDue } from '@/lib/social/publish'

// The publisher posts only what the founder approved, once, when it's due —
// and puts a failed post back where it can be seen.

let productId: string
let savedTokens: unknown[] = []
const posted: Array<{ url: string; body: unknown }> = []

beforeAll(async () => {
  const { data: tokens } = await db().from('social_tokens').select('*')
  savedTokens = tokens ?? []
  await db().from('social_tokens').delete().neq('platform', '')
  await db().from('social_tokens').insert({ platform: 'twitter', access_token: 'tok', platform_user_id: '1' })
  const { data } = await db().from('products').insert({ name: 'Publish test', url: 'https://example.test', night_enabled: false }).select('id').single()
  productId = data!.id
})

afterAll(async () => {
  await db().from('products').delete().eq('id', productId)
  await db().from('social_tokens').delete().neq('platform', '')
  if (savedTokens.length) await db().from('social_tokens').insert(savedTokens)
})

afterEach(() => vi.unstubAllGlobals())

const realFetch = globalThis.fetch

/** Fake X; everything else (the local database) goes through untouched. */
function stubX(status = 200) {
  posted.length = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://api.twitter.com')) return realFetch(input, init)
    posted.push({ url, body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify({ data: { id: '777' } }), { status })
  })
}

async function item(fields: Record<string, unknown>) {
  const { data } = await db().from('content_items').insert({
    product_id: productId, platform: 'twitter', title: 't', body: 'Hello world', status: 'approved',
    scheduled_at: new Date(Date.now() - 60_000).toISOString(), ...fields,
  }).select('id').single()
  return data!.id as string
}

describe('publishing approved posts', () => {
  it('posts what is approved and due — once — and records it', async () => {
    stubX()
    const due = await item({ hashtags: ['proof'] })
    const draft = await item({ status: 'draft' })
    const later = await item({ scheduled_at: new Date(Date.now() + 3600_000).toISOString() })

    expect(await publishDue()).toEqual({ posted: 1, failed: 0 })
    expect(posted).toHaveLength(1)
    expect((posted[0].body as { text: string }).text).toBe('Hello world\n\n#proof')

    const { data } = await db().from('content_items').select('id, status, performance_json').in('id', [due, draft, later])
    const by = Object.fromEntries(data!.map(r => [r.id, r]))
    expect(by[due].status).toBe('posted')
    expect(by[due].performance_json.post_url).toBe('https://x.com/i/web/status/777')
    expect(by[draft].status).toBe('draft')
    expect(by[later].status).toBe('approved')

    expect(await publishDue()).toEqual({ posted: 0, failed: 0 })   // never twice
  })

  it('refuses a post X would truncate, and keeps it visible with the reason', async () => {
    stubX()
    const long = await item({ body: 'x'.repeat(300) })
    expect((await publishDue()).failed).toBe(1)
    expect(posted).toHaveLength(0)
    const { data } = await db().from('content_items').select('status, performance_json').eq('id', long).single()
    expect(data!.status).toBe('approved')
    expect(data!.performance_json.last_error).toMatch(/280/)
    await db().from('content_items').delete().eq('id', long)
  })

  it('stops and asks to reconnect when the platform rejects the login', async () => {
    stubX(401)
    await item({})
    await item({})
    const res = await publishDue()
    expect(res.failed).toBe(1)          // the second is not attempted
    const { data: n } = await db().from('notifications').select('action_url').eq('product_id', productId).eq('type', 'post_failed')
      .order('created_at', { ascending: false }).limit(1).single()
    expect(n!.action_url).toBe('/settings')
  })
})
