import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { APPROVE_CHANGED, APPROVE_RELOAD, approveContent, editContent, editOutreach, rejectItem } from '@/lib/engine/items'
import { CHANGED } from '@/lib/engine/send-guard'

// Send sends the words the card showed, once; Approve approves the version the card showed.
// Resend is faked, and its key here is a fake one, so no email can leave this machine.

const saved = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL }
process.env.RESEND_API_KEY = 're_test_not_a_real_key'
process.env.RESEND_FROM_EMAIL = 'markos@example.test'
// The routes read the sender when they load, so they load after the fake one is in place.
const { POST: sendOutreach } = await import('@/app/api/outreach/[id]/send/route')
const { POST: sendCustomer } = await import('@/app/api/customers/[id]/send/route')
const { POST: sendPitch } = await import('@/app/api/pipeline/[id]/send/route')
const { POST: bulkApprove } = await import('@/app/api/items/content/bulk/route')
const { POST: itemAction } = await import('@/app/api/items/[kind]/[id]/route')
const { PATCH: patchPitch } = await import('@/app/api/pipeline/[id]/route')

let productId = ''
const realFetch = globalThis.fetch
const sent: Array<{ to: string; subject: string; html: string }> = []

/** Fake Resend: answers `status`, after running `meanwhile` (if any) while the email is "in flight". */
function stubResend(status = 200, meanwhile?: () => Promise<unknown>) {
  sent.length = 0
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://api.resend.com')) return realFetch(input, init)
    if (meanwhile) await meanwhile()
    if (status !== 200) return new Response('Resend is down', { status })
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ id: `email_${sent.length}` }), { status: 200 })
  })
}

type SendRoute = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const post = (route: SendRoute, id: string, body: Record<string, unknown>) =>
  route(new Request(`http://localhost/api/x/${id}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) })

beforeAll(async () => {
  const { data, error } = await db().from('products').insert({ name: 'TEST: send and approve', url: 'https://send.example.test', night_enabled: false }).select('id').single()
  if (error) throw error
  productId = data.id
})

afterEach(() => vi.unstubAllGlobals())

afterAll(async () => {
  await db().from('products').delete().eq('id', productId)
  process.env.RESEND_API_KEY = saved.key
  process.env.RESEND_FROM_EMAIL = saved.from
})

/** A target ready to email. Inserted without updated_at, so its version has microseconds, as real rows do. */
async function target(fields: Record<string, unknown> = {}) {
  const { data, error } = await db().from('outreach_targets').insert({
    product_id: productId, type: 'creator', name: 'Test creator', status: 'approved', handle_or_email: 'creator@example.test',
    contact_confirmed: true, draft_subject: 'Hello', outreach_draft: 'The words on the card', ...fields,
  }).select('*').single()
  if (error) throw error
  return data as Record<string, string | null>
}
const shownOutreach = (t: Record<string, string | null>) => ({ version: t.updated_at, to: t.handle_or_email, subject: t.draft_subject, body: t.outreach_draft })
const outreachRow = async (id: string) => (await db().from('outreach_targets').select('status, sent_at, updated_at, outreach_draft').eq('id', id).single()).data!

describe('Send', () => {
  it('sends once when Send is pressed twice at the same moment', async () => {
    stubResend()
    const t = await target()
    const results = await Promise.all([post(sendOutreach, t.id!, shownOutreach(t)), post(sendOutreach, t.id!, shownOutreach(t))])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ to: 'creator@example.test', subject: 'Hello' })
    expect(sent[0].html).toContain('The words on the card')
    expect((await outreachRow(t.id!)).status).toBe('contacted')
    // and never again
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(409)
    expect(sent).toHaveLength(1)
  })

  it('refuses when the message was rewritten after the page loaded', async () => {
    stubResend()
    const t = await target()
    await editOutreach(t.id!, { outreach_draft: 'Words the founder never saw' })
    const res = await post(sendOutreach, t.id!, shownOutreach(t))
    expect(res.status).toBe(409)
    expect(sent).toHaveLength(0)
    expect(await outreachRow(t.id!)).toMatchObject({ status: 'approved', sent_at: null, outreach_draft: 'Words the founder never saw' })
  })

  it('refuses, and leaves the row as it was, when the words changed without the version moving', async () => {
    stubResend()
    const t = await target()
    await db().from('outreach_targets').update({ outreach_draft: 'Changed behind its back' }).eq('id', t.id!)
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(409)
    expect(sent).toHaveLength(0)
    expect(await outreachRow(t.id!)).toMatchObject({ status: 'approved', sent_at: null, updated_at: t.updated_at })
  })

  it('puts the row back when the email fails, so Send works again', async () => {
    stubResend(500)
    const t = await target()
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(502)
    expect(await outreachRow(t.id!)).toMatchObject({ status: 'approved', sent_at: null, updated_at: t.updated_at })
    stubResend()
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('counts an email Resend took as sent, even when its answer can’t be read', async () => {
    const t = await target()
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (!url.startsWith('https://api.resend.com')) return realFetch(input, init)
      return new Response('<html>not json</html>', { status: 200 })
    })
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(200)
    expect(await outreachRow(t.id!)).toMatchObject({ status: 'contacted' })
    expect((await outreachRow(t.id!)).sent_at).not.toBeNull()
  })

  it('leaves a target removed while its email was going out removed, when the email then fails', async () => {
    const t = await target()
    stubResend(500, () => rejectItem('outreach_targets', t.id!))
    expect((await post(sendOutreach, t.id!, shownOutreach(t))).status).toBe(502)
    expect(await outreachRow(t.id!)).toMatchObject({ status: 'rejected', sent_at: null })
  })

  it('leaves a pitch dropped while it was going out dropped, when the email then fails', async () => {
    const { data: p } = await db().from('pipeline').insert({
      product_id: productId, kind: 'partner', name: 'Dropped partner', contact: 'dropped@example.test', contact_confirmed: true,
      pitch_subject: 'A partnership', pitch_body: 'Shall we?',
    }).select('*').single()
    const shown = { version: p!.updated_at, to: p!.contact, subject: p!.pitch_subject, body: p!.pitch_body }
    const drop = () => patchPitch(new Request(`http://localhost/api/pipeline/${p!.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'dropped' }),
    }) as unknown as NextRequest, { params: Promise.resolve({ id: p!.id }) })
    stubResend(500, drop)
    expect((await post(sendPitch, p!.id, shown)).status).toBe(502)
    expect((await db().from('pipeline').select('stage, last_contacted_at').eq('id', p!.id).single()).data)
      .toEqual({ stage: 'dropped', last_contacted_at: null })
  })

  it('refuses a page from before this check (no version): reload first', async () => {
    stubResend()
    const t = await target()
    const res = await post(sendOutreach, t.id!, { to: t.handle_or_email, subject: t.draft_subject, body: t.outreach_draft })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Reload/)
    expect(sent).toHaveLength(0)
  })

  it('keeps a customer draft until its email has gone, then clears it and notes what was sent', async () => {
    const { data: c } = await db().from('customers').insert({
      product_id: productId, name: 'Test customer', email: 'customer@example.test', draft_subject: 'Quick question', draft_body: 'How is it going?',
    }).select('*').single()
    const shown = { version: c!.updated_at, to: c!.email, subject: c!.draft_subject, body: c!.draft_body }
    stubResend(500)
    expect((await post(sendCustomer, c!.id, shown)).status).toBe(502)
    const kept = (await db().from('customers').select('draft_body, last_contacted_at, updated_at').eq('id', c!.id).single()).data!
    expect(kept).toEqual({ draft_body: 'How is it going?', last_contacted_at: null, updated_at: c!.updated_at })

    // Unsaved words on the card don't match the saved draft: nothing goes.
    stubResend()
    expect((await post(sendCustomer, c!.id, { ...shown, body: 'Edited but not saved' })).status).toBe(409)
    expect(sent).toHaveLength(0)

    expect((await post(sendCustomer, c!.id, shown)).status).toBe(200)
    expect(sent).toHaveLength(1)
    const after = (await db().from('customers').select('draft_body, last_contacted_at').eq('id', c!.id).single()).data!
    expect(after.draft_body).toBeNull()
    expect(after.last_contacted_at).not.toBeNull()
    const { data: notes } = await db().from('customer_notes').select('content').eq('customer_id', c!.id)
    expect(notes!.map(n => n.content)).toEqual(['Sent: Quick question\n\nHow is it going?'])
  })

  it('sends a customer email once when Send is pressed twice at the same moment', async () => {
    const { data: c } = await db().from('customers').insert({
      product_id: productId, name: 'Twice customer', email: 'twice@example.test', draft_subject: 'Hi', draft_body: 'Once only',
    }).select('*').single()
    const shown = { version: c!.updated_at, to: c!.email, subject: c!.draft_subject, body: c!.draft_body }
    stubResend()
    const results = await Promise.all([post(sendCustomer, c!.id, shown), post(sendCustomer, c!.id, shown)])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(sent).toHaveLength(1)
  })

  // The second press can also land after the first has finished (it did on a slow CI machine):
  // the card is out of date then, and must hear that, not "There is no draft to send".
  it('tells a customer card from before the send that it is out of date', async () => {
    const { data: c } = await db().from('customers').insert({
      product_id: productId, name: 'Two tabs customer', email: 'tabs@example.test', draft_subject: 'Hi', draft_body: 'Sent from the other tab',
    }).select('*').single()
    const shown = { version: c!.updated_at, to: c!.email, subject: c!.draft_subject, body: c!.draft_body }
    stubResend()
    expect((await post(sendCustomer, c!.id, shown)).status).toBe(200)
    const again = await post(sendCustomer, c!.id, shown)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: CHANGED })
    expect(sent).toHaveLength(1)
  })

  it('tells a pipeline card from before the pitch went that it is out of date, without offering to send again', async () => {
    const { data: p } = await db().from('pipeline').insert({
      product_id: productId, kind: 'partner', name: 'Two tabs partner', contact: 'tabs-partner@example.test', contact_confirmed: true,
      pitch_subject: 'A partnership', pitch_body: 'Shall we?',
    }).select('*').single()
    const shown = { version: p!.updated_at, to: p!.contact, subject: p!.pitch_subject, body: p!.pitch_body }
    stubResend()
    expect((await post(sendPitch, p!.id, shown)).status).toBe(200)
    const again = await post(sendPitch, p!.id, shown)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: CHANGED })
    expect(sent).toHaveLength(1)
  })

  it('asks before pitching someone already contacted', async () => {
    const { data: p } = await db().from('pipeline').insert({
      product_id: productId, kind: 'partner', name: 'Test partner', contact: 'partner@example.test', contact_confirmed: true,
      pitch_subject: 'A partnership', pitch_body: 'Shall we?', last_contacted_at: new Date(Date.now() - 86400_000).toISOString(),
    }).select('*').single()
    const shown = { version: p!.updated_at, to: p!.contact, subject: p!.pitch_subject, body: p!.pitch_body }
    stubResend()
    const asked = await post(sendPitch, p!.id, shown)
    expect(asked.status).toBe(409)
    expect((await asked.json()).canForce).toBe(true)
    expect(sent).toHaveLength(0)
    expect((await post(sendPitch, p!.id, { ...shown, force: true })).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect((await db().from('pipeline').select('stage').eq('id', p!.id).single()).data!.stage).toBe('contacted')
  })
})

describe('Approve', () => {
  async function draft(fields: Record<string, unknown> = {}) {
    const { data, error } = await db().from('content_items').insert({
      product_id: productId, platform: 'twitter', title: 't', body: 'Draft words', status: 'draft',
      scheduled_at: new Date(Date.now() + 86400_000).toISOString(), ...fields,
    }).select('id, updated_at').single()
    if (error) throw error
    return data as { id: string; updated_at: string }
  }
  const status = async (id: string) => (await db().from('content_items').select('status').eq('id', id).single()).data!.status

  it('approves the version on the card, to the microsecond', async () => {
    const d = await draft()   // the database's own clock
    await approveContent(d.id, d.updated_at)
    expect(await status(d.id)).toBe('approved')
    const micro = await draft({ updated_at: '2026-11-27T01:02:03.123456+00:00' })
    expect(micro.updated_at).toMatch(/\.123456/)
    await approveContent(micro.id, micro.updated_at)
    expect(await status(micro.id)).toBe('approved')
  })

  it('refuses when the piece was rewritten after the page loaded', async () => {
    const d = await draft()
    await editContent(d.id, { body: 'Words the founder never saw' })
    await expect(approveContent(d.id, d.updated_at)).rejects.toThrow(APPROVE_CHANGED)
    expect(await status(d.id)).toBe('draft')
  })

  it('answers 409 when the card is out of date, so the page can show what’s there now', async () => {
    const d = await draft()
    await editContent(d.id, { body: 'Rewritten after the page loaded' })
    const res = await itemAction(new Request(`http://localhost/api/items/content/${d.id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve', version: d.updated_at }),
    }), { params: Promise.resolve({ kind: 'content', id: d.id }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe(APPROVE_CHANGED)
    expect(await status(d.id)).toBe('draft')
  })

  it('refuses without a version, and never approves what isn’t a draft', async () => {
    const d = await draft()
    await expect(approveContent(d.id, '')).rejects.toThrow(APPROVE_RELOAD)
    const posted = await draft({ status: 'posted' })
    await expect(approveContent(posted.id, posted.updated_at)).rejects.toThrow(APPROVE_CHANGED)
    expect(await status(posted.id)).toBe('posted')
  })

  it('Approve all approves only the drafts the page showed, at the versions shown, and counts what it did', async () => {
    const a = await draft()
    const b = await draft()
    const gap = await draft({ body: 'Hi [Name], have a look' })
    const shown = [a, b, gap].map(d => ({ id: d.id, version: d.updated_at }))
    await editContent(b.id, { body: 'Rewritten after the page loaded' })
    const arrived = await draft()   // a new draft the page never showed
    const res = await bulkApprove(new Request('http://localhost/api/items/content/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId, items: shown }),
    }))
    expect(await res.json()).toEqual({ success: true, approved: 1, skipped: 1, changed: 1 })
    expect([await status(a.id), await status(b.id), await status(gap.id), await status(arrived.id)]).toEqual(['approved', 'draft', 'draft', 'draft'])
  })
})
