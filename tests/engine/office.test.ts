import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import type { ProviderRequest } from '@/lib/llm/types'
import { bookMeeting, endMeeting, findSlot, planMeetings, sayInMeeting } from '@/lib/engine/execs/office'
import { runChecks } from '@/lib/engine/execs/qa'
import { synthesiseNote } from '@/lib/engine/execs/customers'
import { createTasks, executeTask } from '@/lib/engine/execs/tasks'

// Myra (the EA), the meeting room, QA's live checks and the Customer team —
// on the real local database with a fake AI and a fake web.

const NAME = 'Office test product'
let productId: string
let savedProfile: Record<string, unknown> | null = null
let savedModels: unknown
const startedAt = new Date().toISOString()
const realFetch = globalThis.fetch
const props = (req: ProviderRequest) => Object.keys((req.jsonSchema?.properties ?? {}) as object)

function fakeOffice(req: ProviderRequest) {
  const k = props(req)
  if (k.includes('pre_read')) return { text: JSON.stringify({ title: 'CFO · pricing', purpose: 'Decide the team plan price', agenda: [{ item: 'Price', owner: 'cfo', decision_needed: true }], pre_read: 'Options A and B.' }) }
  if (k.includes('replies')) return { text: JSON.stringify({ replies: [{ speaker: 'cfo', text: 'I recommend B: ₹3,999 base.' }, { speaker: 'cmo', text: 'Not in this meeting' }] }) }
  if (k.includes('action_items')) return { text: JSON.stringify({
    summary: 'Chose B.', decisions: [{ decision: 'Price B', by: 'founder' }], open_questions: [],
    action_items: [
      { owner: 'cfo', product: NAME, task: 'Update the pricing page copy', due: '2026-10-21' },
      { owner: 'founder', product: null, task: 'Tell the two pilot customers', due: '2026-10-20' },
    ],
  }) }
  if (k.includes('earliest')) return { text: JSON.stringify({ execs: ['cfo'], product: NAME, topic: 'Pricing', kind: 'decision', duration_min: 20, earliest: null }) }
  if (k.includes('quotes')) return { text: JSON.stringify({
    summary: 'They love search but signup broke.',
    quotes: ['the search is magic', 'I invented this quote'],
    pains: ['signup'], feature_requests: ['Export to CSV'],
    bugs: [{ title: 'Signup OTP never arrives', severity: 'high', evidence: 'OTP never came' }],
    for_marketing: ['magic search'], follow_up: { subject: 'Thanks', body: 'Fixing the OTP today.' },
  }) }
  return { text: '{}' }
}

beforeAll(async () => {
  const { data: profile } = await db().from('profiles').select('*').eq('id', 1).single()
  savedProfile = profile
  savedModels = profile?.agent_models ?? {}
  const { data } = await db().from('products').insert({ name: NAME, url: 'https://office.test', night_enabled: false }).select('id').single()
  productId = data!.id
})

afterAll(async () => {
  // Every meeting this file booked, so none can ever be synced to the real calendar.
  await db().from('meetings').delete().gte('created_at', startedAt)
  await db().from('team_messages').delete().gte('created_at', startedAt)
  await db().from('exec_reports').delete().gte('created_at', startedAt)
  await db().from('tasks').delete().eq('product_id', productId)
  await db().from('tasks').delete().eq('exec', 'founder').eq('task', 'Tell the two pilot customers')
  await db().from('products').delete().eq('id', productId)
})

beforeEach(() => setFakeHandler(fakeOffice))
afterEach(() => vi.unstubAllGlobals())

describe('Myra finds time', () => {
  const windows: Array<[string, string]> = [['11:00', '13:00'], ['16:00', '18:00']]
  const monday = new Date('2026-10-19T08:00:00')

  it('books inside a meeting window, never in focus time', () => {
    const slot = findSlot({ from: monday, durationMin: 20, windows, maxPerDay: 3, busy: [] })!
    expect(slot.getHours()).toBe(11)
    expect(slot.getMinutes()).toBe(0)
  })

  it('leaves 10 minutes between meetings', () => {
    const slot = findSlot({ from: monday, durationMin: 20, windows, maxPerDay: 3, busy: [{ start: new Date('2026-10-19T11:00:00'), durationMin: 30 }] })!
    expect(slot.toTimeString().slice(0, 5)).toBe('11:45')
  })

  it('respects the daily limit and skips Sunday', () => {
    const busy = [{ start: new Date('2026-10-24T11:00:00'), durationMin: 20 }, { start: new Date('2026-10-24T12:00:00'), durationMin: 20 }]
    const slot = findSlot({ from: new Date('2026-10-24T08:00:00'), durationMin: 20, windows, maxPerDay: 2, busy })!
    expect(slot.toDateString()).toBe(new Date('2026-10-26T00:00:00').toDateString())   // Saturday full, Sunday skipped → Monday
  })
})

describe('meetings', () => {
  it('books with an agenda, runs the room, and turns minutes into dated work', async () => {
    const booked = await bookMeeting({ execs: ['cfo'], productId, kind: 'decision', topic: 'Pricing', items: ['Decide price'] })
    expect(booked).not.toBeNull()
    const { data: m } = await db().from('meetings').select('*').eq('id', booked!.id).single()
    expect(m!.pre_read).toBe('Options A and B.')
    expect(new Date(m!.scheduled_at).getHours()).toBeGreaterThanOrEqual(11)

    const replies = await sayInMeeting(booked!.id, 'Which price?')
    expect(replies.map(r => r.speaker)).toEqual(['cfo'])     // the CMO isn't in this meeting

    const minutes = await endMeeting(booked!.id)
    expect(minutes!.decisions[0].decision).toBe('Price B')
    const { data: work } = await db().from('tasks').select('exec, task, due, origin').eq('product_id', productId).eq('exec', 'cfo')
    expect(work).toContainEqual(expect.objectContaining({ task: 'Update the pricing page copy', due: '2026-10-21', origin: 'founder' }))
    const { data: mine } = await db().from('tasks').select('status').eq('exec', 'founder').eq('task', 'Tell the two pilot customers')
    expect(mine![0].status).toBe('queued')
  })

  it('a task for Myra books a meeting', async () => {
    const [id] = await createTasks([{ exec: 'ea', productId, task: 'Set up time with the CFO about pricing' }])
    await executeTask(id)
    const { data: t } = await db().from('tasks').select('status, result_summary').eq('id', id).single()
    expect(t!.status).toBe('done')
    expect(t!.result_summary).toMatch(/Booked for/)
  })

  it('books one decision meeting for what needs the founder — and no more while one is coming up', async () => {
    // Set the founder's real upcoming meetings aside for this test, then put them back.
    const { data: held } = await db().from('meetings').update({ status: 'held_for_test' }).eq('status', 'scheduled').select('id')
    const { data: night } = await db().from('nights').insert({ status: 'completed' }).select('id').single()
    await db().from('exec_reports').insert({ night_id: night!.id, exec: 'sales', product_id: productId, report: {
      headline: 'h', done: [], decisions_needed: [{ question: 'Which 10 design partners?', options: ['a'], recommendation: 'a', why: 'w' }],
      risks: [], metrics: [], numbers_needed: [], insights: [], moves: [], handoffs: [], issues: [], next_24h: [],
    } })
    try {
      const ids = await planMeetings(night!.id)
      const { data: m } = await db().from('meetings').select('execs, kind').in('id', ids)
      expect(m!.filter(x => x.kind === 'decision')).toHaveLength(1)
      expect(m!.some(x => x.kind === 'decision' && (x.execs as string[]).includes('sales'))).toBe(true)
      // A second night the same day books no second decision meeting.
      const again = await planMeetings(night!.id)
      expect(again.filter(id => !ids.includes(id))).toEqual([])
      await db().from('meetings').delete().in('id', ids)
    } finally {
      await db().from('nights').delete().eq('id', night!.id)
      if (held?.length) await db().from('meetings').update({ status: 'scheduled' }).in('id', held.map(h => h.id))
    }
  })
})

describe('QA live checks', () => {
  it('files a failing page as an issue and closes it when the page recovers', async () => {
    let healthy = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      // Match the host, not the text: database queries can mention office.test too.
      if (new URL(url).host !== 'office.test') return realFetch(input, init)
      if (url.endsWith('/sitemap.xml')) return new Response('<urlset><loc>https://office.test/pricing</loc></urlset>')
      if (url.endsWith('/pricing') && !healthy) return new Response('<title>x</title>Application error', { status: 200 })
      return new Response('<html><title>Office</title></html>')
    })
    const first = await runChecks(productId)
    expect(first.find(c => c.url.endsWith('/pricing'))!.ok).toBe(false)
    const { data: open } = await db().from('issues').select('status, severity').eq('product_id', productId).eq('title', 'Live page failing: https://office.test/pricing').single()
    expect(open).toEqual({ status: 'open', severity: 'high' })

    healthy = true
    await runChecks(productId)
    const { data: closed } = await db().from('issues').select('status').eq('product_id', productId).eq('title', 'Live page failing: https://office.test/pricing').single()
    expect(closed!.status).toBe('fixed')
  })
})

describe('the Customer team', () => {
  it('keeps only real quotes, files bugs, and routes the rest', async () => {
    const { data: c } = await db().from('customers').insert({ product_id: productId, name: 'Asha', email: 'asha@acme.test' }).select('id').single()
    const s = await synthesiseNote(productId, 'Asha said: the search is magic. But the OTP never came when I signed up.', c!.id)
    expect(s.quotes).toEqual(['the search is magic'])
    const { data: bug } = await db().from('issues').select('origin').eq('product_id', productId).eq('title', 'Signup OTP never arrives').single()
    expect(bug!.origin).toBe('customer')
    const { data: work } = await db().from('tasks').select('exec').eq('product_id', productId).eq('origin', 'cx')
    expect(work!.map(w => w.exec).sort()).toEqual(['cmo', 'cpo', 'cto'])
    const { data: draft } = await db().from('customers').select('draft_subject').eq('id', c!.id).single()
    expect(draft!.draft_subject).toBe('Thanks')
  })
})
