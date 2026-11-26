import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS } from '@/lib/llm/models'
import type { ProviderRequest } from '@/lib/llm/types'
import { founderSays, mentions } from '@/lib/engine/execs/team-room'

// The team room: agents answer as themselves, act, and talk to each other —
// within limits — on the real local database with a fake AI.

let savedModels: unknown
const startedAt = new Date().toISOString()
const props = (req: ProviderRequest) => Object.keys((req.jsonSchema?.properties ?? {}) as object)
let picks: string[] = ['cmo']

function fakeRoom(req: ProviderRequest) {
  const k = props(req)
  if (k.includes('responders')) return { text: JSON.stringify({ responders: picks }) }
  if (k.includes('actions') && k.includes('text')) {
    const me = req.system.includes('You are the CFO') ? 'cfo' : req.system.includes('You are the CMO') ? 'cmo' : 'other'
    return { text: JSON.stringify(me === 'cfo'
      ? { text: 'Runway is unknown until you enter cash. I’ll ask Sales what’s closing.', actions: [
          { type: 'ask', to: 'sales', product: null, content: 'Which deals could close this month?', due: null },
          { type: 'task', to: 'cpo', product: null, content: 'List features customers would pay more for', due: null },
        ] }
      : { text: 'On it — I’ll draft three posts.', actions: [] }) }
  }
  if (k.includes('task') && k.includes('text')) {
    // A teammate answering: it must never be able to ask back (its schema has no "ask").
    return { text: JSON.stringify({ text: 'Two design partners are close; none will pay this month.', task: null }) }
  }
  if (k.includes('deliverable')) {
    return { text: JSON.stringify({ summary: 'Listed three.', deliverable: '- a\n- b\n- c', findings: [], content_drafts: [], pipeline_adds: [], numbers_needed: [], handoffs: [], open_questions: [] }) }
  }
  return { text: '{}' }
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v as T
    if (Date.now() > until) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 150))
  }
}

beforeAll(async () => {
  const { data } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  savedModels = data?.agent_models ?? {}
})

afterAll(async () => {
  await db().from('team_messages').delete().gte('created_at', startedAt)
  await db().from('exec_reports').delete().gte('created_at', startedAt)
  await db().from('tasks').delete().gte('created_at', startedAt)
})

beforeEach(() => { setFakeHandler(fakeRoom); picks = ['cmo'] })

const messagesAfter = async (id: string) => {
  const { data: first } = await db().from('team_messages').select('created_at').eq('id', id).single()
  const { data } = await db().from('team_messages').select('*').gte('created_at', first!.created_at).order('created_at')
  return data ?? []
}

describe('the team room', () => {
  it('reads @mentions, in any case', () => {
    expect(mentions('@CFO and @myra please')).toEqual(['cfo', 'ea'])
    expect(mentions('hey team')).toEqual([])
  })

  it('an @mentioned exec answers as itself, asks a teammate, and hands work over', async () => {
    const id = await founderSays('@cfo what is our runway?')
    const msgs = await waitFor(async () => {
      const m = await messagesAfter(id)
      return m.some(x => x.kind === 'answer') && m.some(x => x.kind === 'done' && x.speaker === 'cpo') ? m : null
    })
    const say = (speaker: string, kind: string) => msgs.find(m => m.speaker === speaker && m.kind === kind)
    expect(say('cfo', 'chat')!.content).toMatch(/Runway is unknown/)
    expect(say('cfo', 'question')!.to_seats).toEqual(['sales'])
    expect(say('sales', 'answer')!.to_seats).toEqual(['cfo'])
    expect(say('cfo', 'handoff')!.to_seats).toEqual(['cpo'])
    expect(say('cpo', 'done')!.content).toMatch(/Listed three/)
    // Only the CFO was asked: nobody else jumped in.
    expect(msgs.filter(m => m.kind === 'chat' && m.speaker !== 'founder').map(m => m.speaker)).toEqual(['cfo'])
  })

  it('without a mention, the Chief of Staff picks who answers — never more than three', async () => {
    picks = ['cmo', 'cfo', 'cpo', 'cto', 'sales']
    const id = await founderSays('how are we doing?')
    const msgs = await waitFor(async () => {
      const m = await messagesAfter(id)
      return m.filter(x => x.kind === 'chat' && x.speaker !== 'founder').length >= 3 ? m : null
    })
    await new Promise(r => setTimeout(r, 500))
    const speakers = (await messagesAfter(id)).filter(x => x.kind === 'chat' && x.speaker !== 'founder').map(x => x.speaker)
    expect(new Set(speakers).size).toBe(3)
    expect(msgs[0].speaker).toBe('founder')
  })
})
