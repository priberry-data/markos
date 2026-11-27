import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { editContent, refineItem, rejectItem, restoreVersion } from '@/lib/engine/items'
import { setFakeHandler } from '@/lib/llm/providers/fake'
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

describe('an approved post whose words change', () => {
  /** The AI's rewrite of a post. */
  const rewrite = (body: string) => JSON.stringify({ title: 't', hook: 'h', body, hashtags: [], cta: 'c' })
  const row = async (id: string) => (await db().from('content_items').select('status, body').eq('id', id).single()).data

  beforeEach(async () => {
    // Only this block's posts are due.
    await db().from('content_items').delete().eq('product_id', productId)
  })
  afterEach(() => setFakeHandler(() => ({ text: '{}' })))

  it('goes back to draft when the AI rewrites it, so words the founder never saw never post', async () => {
    stubX()
    setFakeHandler(() => ({ text: rewrite('Words the founder never saw') }))
    const id = await item({ body: 'Approved words' })
    expect(await refineItem('content_items', id, 'make it punchier')).toMatchObject({ needsApproval: true })
    expect(await publishDue()).toEqual({ posted: 0, failed: 0 })
    expect(posted).toHaveLength(0)
    expect(await row(id)).toEqual({ status: 'draft', body: 'Words the founder never saw' })
    // The approved words stay in its history.
    const { data: versions } = await db().from('item_versions').select('content').eq('item_id', id)
    expect(versions!.map(v => (v.content as { body: string }).body)).toContain('Approved words')
  })

  it('keeps its approval after the founder’s own edit: their words post as written', async () => {
    stubX()
    const id = await item({ body: 'Approved words' })
    await editContent(id, { body: 'The founder’s own words' })
    expect(await publishDue()).toEqual({ posted: 1, failed: 0 })
    expect((posted[0].body as { text: string }).text).toBe('The founder’s own words')
  })

  it('goes back to draft when an earlier version is put back', async () => {
    stubX()
    const id = await item({ body: 'Approved words' })
    await editContent(id, { body: 'Edited words' })
    const { data: v } = await db().from('item_versions').select('id').eq('item_id', id).single()
    expect(await restoreVersion(v!.id)).toEqual({ needsApproval: true })
    expect(await publishDue()).toEqual({ posted: 0, failed: 0 })
    expect(await row(id)).toEqual({ status: 'draft', body: 'Approved words' })
  })

  it('keeps the words that went out when it posts while the AI is still rewriting it', async () => {
    stubX()
    const id = await item({ body: 'Approved words' })
    setFakeHandler(async () => {
      await publishDue()   // its time comes while the AI writes
      return { text: rewrite('Too late') }
    })
    await expect(refineItem('content_items', id, 'shorter')).rejects.toThrow(/nothing was saved/)
    expect(posted).toHaveLength(1)
    expect(await row(id)).toEqual({ status: 'posted', body: 'Approved words' })
    // Nothing was rewritten, so History doesn't say it was.
    const { data: versions } = await db().from('item_versions').select('reason').eq('item_id', id)
    expect(versions).toEqual([])
  })

  /** Fake X that runs `meanwhile` while the post is in flight, then answers with `status`. */
  function stubXMeanwhile(meanwhile: () => Promise<unknown>, status: number) {
    posted.length = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (!url.startsWith('https://api.twitter.com')) return realFetch(input, init)
      await meanwhile()
      posted.push({ url, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(status === 200 ? { data: { id: '778' } } : { title: 'Service Unavailable' }), { status })
    })
  }

  it('refuses a rewrite while it is going out', async () => {
    setFakeHandler(() => ({ text: rewrite('Never saved') }))
    const id = await item({ body: 'Approved words' })
    let refused: Error | null = null
    stubXMeanwhile(async () => { refused = await refineItem('content_items', id, 'shorter').then(() => null, e => e) }, 503)
    expect((await publishDue()).failed).toBe(1)
    expect(refused).toBeInstanceOf(Error)
    expect(refused!.message).toMatch(/going out right now/)
    // The post failed, so it waits approved, with the words that were approved.
    expect(await row(id)).toEqual({ status: 'approved', body: 'Approved words' })
    const { data: versions } = await db().from('item_versions').select('reason').eq('item_id', id)
    expect(versions).toEqual([])
  })

  it('refuses to put an earlier version back while it is going out', async () => {
    const id = await item({ body: 'Approved words' })
    await editContent(id, { body: 'Edited words' })
    const { data: v } = await db().from('item_versions').select('id').eq('item_id', id).single()
    let refused: Error | null = null
    stubXMeanwhile(async () => { refused = await restoreVersion(v!.id).then(() => null, e => e) }, 200)
    expect(await publishDue()).toEqual({ posted: 1, failed: 0 })
    expect(refused).toBeInstanceOf(Error)
    expect(refused!.message).toMatch(/going out right now/)
    // What went out is what it records as posted, and History holds only the edit's copy.
    expect((posted[0].body as { text: string }).text).toBe('Edited words')
    expect(await row(id)).toEqual({ status: 'posted', body: 'Edited words' })
    const { data: versions } = await db().from('item_versions').select('reason').eq('item_id', id)
    expect(versions).toEqual([{ reason: 'edited' }])
  })

  it('stays rejected when the founder rejects it while it is going out and the post fails', async () => {
    const id = await item({ body: 'Approved words' })
    stubXMeanwhile(() => rejectItem('content_items', id), 503)
    expect((await publishDue()).failed).toBe(1)
    expect((await row(id))!.status).toBe('rejected')
    expect(await publishDue()).toEqual({ posted: 0, failed: 0 })
  })

  it('is recorded as posted when the founder rejects it while it is going out and the post succeeds', async () => {
    const id = await item({ body: 'Approved words' })
    stubXMeanwhile(() => rejectItem('content_items', id), 200)
    expect(await publishDue()).toEqual({ posted: 1, failed: 0 })
    const { data } = await db().from('content_items').select('status, published_at').eq('id', id).single()
    expect(data!.status).toBe('posted')
    expect(data!.published_at).not.toBeNull()
  })

  it('keeps a rewritten outreach message in Ready to contact: an email goes out only when the founder presses Send', async () => {
    setFakeHandler(() => ({ text: JSON.stringify({ draft_subject: 'Hi', draft_message: 'New words' }) }))
    const { data: t } = await db().from('outreach_targets').insert({
      product_id: productId, type: 'creator', name: 'Test creator', status: 'approved', outreach_draft: 'Approved words',
    }).select('id').single()
    expect(await refineItem('outreach_targets', t!.id, 'shorter')).toMatchObject({ needsApproval: false })
    const { data } = await db().from('outreach_targets').select('status, outreach_draft').eq('id', t!.id).single()
    expect(data).toEqual({ status: 'approved', outreach_draft: 'New words' })
  })
})
