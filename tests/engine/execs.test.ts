import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { setFakeHandler } from '@/lib/llm/providers/fake'
import { AGENT_KEYS, teamDefault } from '@/lib/llm/models'
import { applyModelSettings } from '@/lib/engine/execs/context'
import { ProviderError, type ProviderRequest } from '@/lib/llm/types'
import { submitDirective } from '@/lib/engine/execs/chief-of-staff'
import { confirmIntake } from '@/lib/engine/execs/intake'
import { fallbackBrief, startNight } from '@/lib/engine/execs/night'
import { writeReport } from '@/lib/engine/execs/report'
import { executeTask, createTasks } from '@/lib/engine/execs/tasks'

// The executive team end to end: the real local database, the real engine, a
// fake AI that answers by which shape it was asked for.

const NAME = 'Exec test product'
let productId: string
let repo: string
let savedModels: unknown
const otherNightFlags: Array<{ id: string; night_enabled: boolean }> = []
let usageLimit = false
const nights: string[] = []
let startedAt = ''

const REAL = { title: 'Acme hiring', url: 'https://acme.test/careers' }
const props = (req: ProviderRequest) => Object.keys((req.jsonSchema?.properties ?? {}) as object)

function fakeTeam(req: ProviderRequest) {
  if (usageLimit) throw new ProviderError('You’ve hit your limit', 'usage_limit')
  const keys = props(req)
  if (req.grounded || (!req.jsonSchema && req.readPaths)) {
    return { text: 'Acme is hiring 40 engineers [1].', sources: [REAL], evidence: 'Acme careers — write to hi@acme.test' }
  }
  if (keys.includes('understanding')) {
    return { text: JSON.stringify({
      understanding: 'Check pricing and find design partners',
      clarify: null,
      tasks: [
        { exec: 'cfo', product: null, task: 'Review pricing across the portfolio', why: 'paisa', priority: 'high', due: null },
        { exec: 'sales', product: NAME, task: 'Find design partners', why: 'partners', priority: 'normal', due: '2026-12-01' },
      ],
    }) }
  }
  if (keys.includes('deliverable')) {
    return { text: JSON.stringify({
      summary: 'Found two companies.',
      deliverable: '## Prospects\n- Acme',
      findings: [{ point: 'Acme is hiring', source: REAL.url }, { point: 'Made up', source: 'https://invented.test/x' }],
      content_drafts: [
        { platform: 'linkedin', title: 'Good post', body: 'We verify skills.' },
        { platform: 'linkedin', title: 'Bad post', body: 'Hi [Name], buy now' },
      ],
      pipeline_adds: [
        { kind: 'company', name: 'Acme', website: 'https://acme.test', why_fit: 'Hiring fast', contact: 'hi@acme.test', source: REAL.url, pitch_subject: 'Hi', pitch_body: 'Short pitch' },
        { kind: 'company', name: 'Ghost Co', website: null, why_fit: 'Maybe', contact: 'ceo@ghost.test', source: 'https://invented.test/y', pitch_subject: null, pitch_body: null },
      ],
      numbers_needed: [],
      handoffs: [{ to: 'cmo', task: 'Announce the design partner programme', why: 'Sales needs air cover' }],
      open_questions: [],
    }) }
  }
  if (keys.includes('next_24h')) {
    return { text: JSON.stringify({
      headline: 'Quiet night',
      done: [{ what: 'Read the repo' }],
      decisions_needed: [],
      risks: [{ risk: 'Invented risk', severity: 'low', source: 'https://invented.test/z' }, { risk: 'Real file', severity: 'medium', source: `${repo}/README.md` }],
      metrics: [{ name: 'Users', value: '42', basis: null }, { name: 'Commits', value: '1', basis: 'FACTS' }],
      numbers_needed: ['Paid users'],
      insights: [{ finding: 'Nothing was published', evidence: 'posts published: 0 vs 0' }],
      moves: [
        { move: 'Draft three founder posts', why_now: 'nothing published', expected_impact: 'posts go out', confidence: 'medium', effort: 'small', mode: 'doing_it', task: 'Draft three founder-led LinkedIn posts' },
        { move: 'Change positioning', why_now: 'low replies', expected_impact: 'more replies', confidence: 'low', effort: 'large', mode: 'needs_your_ok', task: null },
        { move: 'Vague idea', why_now: 'x', expected_impact: 'y', confidence: 'low', effort: 'small', mode: 'doing_it', task: null },
      ],
      handoffs: [],
      issues: [{ title: 'Signup button does nothing', severity: 'high', evidence: 'README says so', area: 'signup' }],
      next_24h: ['Keep going'],
    }) }
  }
  if (keys.includes('pre_read')) {
    return { text: JSON.stringify({ title: 'Decision meeting', purpose: 'Decide things', agenda: [{ item: 'Pricing', owner: 'cfo', decision_needed: true }], pre_read: 'Facts.' }) }
  }
  if (keys.includes('top_decisions')) {
    return { text: JSON.stringify({
      headline: 'Two things need you today', top_decisions: [], overnight: [], per_product: [], risks: [], today_focus: ['Approve the strategy'],
      the_one_thing: { product: NAME, focus: 'Get the first post out', why: '0 posts in two weeks' },
      moves: [{ exec: 'cmo', product: NAME, move: 'Draft three founder posts', status: 'team_doing_it' }],
    }) }
  }
  if (keys.includes('claims_rules')) {
    return { text: JSON.stringify({
      one_liner: 'Verified careers', description: 'Proof of skill.', url: null, category: 'Career tech', stage: 'beta',
      target_audience: 'Job seekers', target_geography: 'India', currency: 'INR', pricing_summary: null, brand_voice: 'Plain',
      primary_color: '#7c86ff', secondary_color: null, competitors: ['Rival'], goals: ['10 design partners'],
      claims_rules: ['Never say "guaranteed job"'], offerings: [{ name: 'Finder', what: 'Sourcing agent' }],
      key_docs: [`${repo}/README.md`], conflicts: [{ topic: 'HQ', values: ['San Francisco', 'Berlin'], where: 'a.ts vs b.md' }],
      unknowns: ['Plan prices'],
    }) }
  }
  return { text: '{}' }
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 45_000): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > until) throw new Error('timed out')
    await new Promise(r => setTimeout(r, 150))
  }
}

beforeAll(async () => {
  startedAt = new Date().toISOString()
  repo = mkdtempSync(join(tmpdir(), 'markos-repo-'))
  writeFileSync(join(repo, 'README.md'), '# Test product\n')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: repo })

  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  savedModels = profile?.agent_models ?? {}
  const { data } = await db().from('products').insert({ name: NAME, url: 'https://example.test', repo_paths: [repo] }).select('id').single()
  productId = data!.id
})

afterAll(async () => {
  // Test nights, their notifications and any meetings they booked must never
  // reach the founder: the app syncs upcoming meetings to the real Mac Calendar.
  await db().from('meetings').delete().gte('created_at', startedAt)
  await db().from('team_messages').delete().gte('created_at', startedAt)
  await db().from('exec_reports').delete().gte('created_at', startedAt)
  if (nights.length) await db().from('nights').delete().in('id', nights)
  await db().from('notifications').delete().eq('type', 'brief').gte('created_at', startedAt)
  await db().from('tasks').delete().or(`product_id.eq.${productId},product_id.is.null`).like('task', '%')
  await db().from('directives').delete().like('text', 'TEST:%')
  await db().from('products').delete().eq('id', productId)
  rmSync(repo, { recursive: true, force: true })
})

beforeEach(() => {
  usageLimit = false
  setFakeHandler(fakeTeam)
})

describe('the Chief of Staff routes an instruction', () => {
  it('splits it by meaning and the execs do the work', async () => {
    const id = await submitDirective('TEST: paisa kahan ja raha hai, and get us design partners')
    const d = await waitFor(async () => {
      const { data } = await db().from('directives').select('*').eq('id', id).single()
      return data?.status !== 'routing' ? data : null
    })
    expect(d.status).toBe('routed')

    const tasks = await waitFor(async () => {
      const { data } = await db().from('tasks').select('*').eq('directive_id', id)
      return data?.length === 2 && data.every(t => t.status === 'done' || t.status === 'failed') ? data : null
    })
    const byExec = Object.fromEntries(tasks.map(t => [t.exec, t]))
    expect(byExec.cfo.product_id).toBeNull()
    expect(byExec.sales.product_id).toBe(productId)
    expect(byExec.sales.due).toBe('2026-12-01')
    expect(byExec.sales.status).toBe('done')
  })

  it('keeps only what is real: sources, contacts and clean drafts', async () => {
    const { data: rows } = await db().from('pipeline').select('*').eq('product_id', productId)
    const acme = rows!.find(r => r.name === 'Acme')!
    const ghost = rows!.find(r => r.name === 'Ghost Co')!
    expect(acme.source).toBe(REAL.url)
    expect(acme.verified).toBe(true)
    expect(acme.contact).toBe('hi@acme.test')        // it was in what the web tools returned
    expect(acme.contact_confirmed).toBe(false)        // but the founder still confirms it
    expect(ghost.source).toBeNull()                   // invented page
    expect(ghost.contact).toBeNull()                  // never appeared in a retrieved page

    const { data: drafts } = await db().from('content_items').select('title').eq('product_id', productId)
    expect(drafts!.map(d => d.title)).toEqual(expect.arrayContaining(['Good post']))
    expect(drafts!.map(d => d.title)).not.toContain('Bad post')
  })

  it('lets an exec hand work on once — never in a chain', async () => {
    const { data: handed } = await db().from('tasks').select('*').eq('exec', 'cmo').eq('origin', 'sales').eq('product_id', productId)
    expect(handed!.length).toBe(1)
    await executeTask(handed![0].id)
    const { data: chained } = await db().from('tasks').select('id').eq('origin', 'cmo').eq('product_id', productId)
    expect(chained).toEqual([])
  })
})

describe('exec reports', () => {
  it('carries its skill and the analytics into the model', async () => {
    let seen: ProviderRequest | null = null
    setFakeHandler(req => { if (props(req).includes('next_24h')) seen = req; return fakeTeam(req) })
    await writeReport({ exec: 'sales', productId, nightId: null })
    expect(seen!.system).toContain('YOUR SKILL: Sales & Partnerships')
    expect(seen!.system).toContain('The Mom Test')
    expect(seen!.prompt).toContain('This week vs last (counted by code)')
    expect(seen!.prompt).toContain('Not happening')
  })

  it('turns moves it can do itself into tonight’s work — and only those', async () => {
    await db().from('tasks').delete().eq('exec', 'coo')
    const { report } = await writeReport({ exec: 'coo', productId: null, nightId: null })
    expect(report.moves.map(m => m.mode)).toEqual(['doing_it', 'needs_your_ok', 'needs_your_input'])  // no task → can't be "doing it"
    const { data: own } = await db().from('tasks').select('task, origin, status').eq('exec', 'coo').eq('origin', 'coo')
    expect(own!.map(t => t.task)).toEqual(['Draft three founder-led LinkedIn posts'])
    // a second report doesn't queue the same move twice
    await writeReport({ exec: 'coo', productId: null, nightId: null })
    const { count } = await db().from('tasks').select('id', { count: 'exact', head: true }).eq('exec', 'coo').eq('origin', 'coo')
    expect(count).toBe(1)
    await db().from('tasks').delete().eq('exec', 'coo')
  })

  it('drops numbers without a basis and citations that are not real', async () => {
    const { report } = await writeReport({ exec: 'cto', productId, nightId: null })
    expect(report.metrics.find(m => m.name === 'Users')!.value).toBeNull()
    expect(report.metrics.find(m => m.name === 'Commits')!.value).toBe('1')
    expect(report.risks.find(r => r.risk === 'Invented risk')!.source).toBeNull()
    expect(report.risks.find(r => r.risk === 'Real file')!.source).toBe(`${repo}/README.md`)
  })
})

describe('the night shift', () => {
  // A test night works only on the test product: the founder's products,
  // tasks and settings are never touched.
  it('reads new products, works, reports and leaves a brief', async () => {
    await db().from('products').update({ intake_status: 'none', night_enabled: true }).eq('id', productId)
    const nightId = await startNight('manual', { onlyProducts: [productId] })
    nights.push(nightId)
    const night = await waitFor(async () => {
      const { data } = await db().from('nights').select('*').eq('id', nightId).single()
      return data?.status !== 'running' ? data : null
    }, 120_000)

    expect(night.brief.headline).toBe('Two things need you today')
    expect(night.brief.the_one_thing.focus).toBe('Get the first post out')
    expect(night.analytics.portfolio.trends.map((t: { name: string }) => t.name)).toContain('posts published')
    const { data: product } = await db().from('products').select('intake_status, intake').eq('id', productId).single()
    expect(product!.intake_status).toBe('draft')
    expect(product!.intake.conflicts[0].values).toEqual(['San Francisco', 'Berlin'])

    const { data: reports } = await db().from('exec_reports').select('exec, product_id').eq('night_id', nightId)
    const execs = reports!.map(r => r.exec)
    for (const e of ['cpo', 'cto', 'cmo', 'sales']) expect(execs).toContain(e)
    // A scoped night never writes portfolio-wide reports: those would cover the founder's real products.
    for (const e of ['cfo', 'coo', 'platform']) expect(execs).not.toContain(e)

    const { data: note } = await db().from('notifications').select('title').eq('type', 'brief').order('created_at', { ascending: false }).limit(1).single()
    expect(note!.title).toMatch(/brief is ready/)
  })

  it('stops cleanly at the plan’s usage limit and still leaves an honest brief', async () => {
    usageLimit = true
    const nightId = await startNight('manual', { onlyProducts: [productId] })
    nights.push(nightId)
    const night = await waitFor(async () => {
      const { data } = await db().from('nights').select('*').eq('id', nightId).single()
      return data?.status !== 'running' ? data : null
    }, 60_000)
    expect(night.status).toBe('partial')
    expect(night.paused_reason).toMatch(/usage limit/i)
    expect(night.brief.headline).toMatch(/cut short/)
  })

  it('puts a task stopped by the usage limit back in the queue', async () => {
    const [id] = await createTasks([{ exec: 'cfo', productId: null, task: 'Limit test task' }])
    usageLimit = true
    await expect(executeTask(id)).rejects.toMatchObject({ kind: 'usage_limit' })
    const { data } = await db().from('tasks').select('status').eq('id', id).single()
    expect(data!.status).toBe('queued')
    await db().from('tasks').delete().eq('id', id)
  })

  it('goes on without the web, and says why, when no AI that can search can be used', async () => {
    // Handed on by another exec, so this test adds no handoffs of its own.
    const [id] = await createTasks([{ exec: 'sales', productId, task: 'No-search test task', origin: 'cmo' }])
    let prompt = ''
    setFakeHandler(req => {
      if (req.grounded) throw new ProviderError('Claude Code is installed but not signed in.', 'auth')
      if (props(req).includes('deliverable')) prompt = req.prompt
      return fakeTeam(req)
    })
    await executeTask(id)
    const { data } = await db().from('tasks').select('status, result, result_summary').eq('id', id).single()
    expect(data!.status).toBe('done')
    expect(prompt).toContain('NO WEB SEARCH: the web search couldn’t run (Claude Code is installed but not signed in.)')
    // Where the founder reads it: the task's summary (also in the morning brief) and the team room.
    expect(data!.result_summary).toMatch(/Done without a web search, which couldn’t run: Claude Code is installed but not signed in/)
    const { data: done } = await db().from('team_messages').select('content').eq('task_id', id).eq('kind', 'done').single()
    expect(done!.content).toMatch(/Done without a web search.*not signed in/)
    expect(data!.result.open_questions).toEqual(expect.arrayContaining([expect.stringMatching(/without a web search.*not signed in/)]))
    await db().from('tasks').delete().eq('id', id)
  })

  it('on a team running on another AI, a search stopped by Claude Code’s plan limit is skipped, and the rest of the night goes on', async () => {
    // The team's AI as set for this computer (a choice saved in Settings would win, and no test
    // writes those); the calls themselves still go to the test AI.
    const before = process.env.MARKOS_MODEL_DEFAULT
    process.env.MARKOS_MODEL_DEFAULT = 'ollama:qwen3:8b'
    try {
      await applyModelSettings()
      expect(teamDefault()).toEqual({ provider: 'ollama', model: 'qwen3:8b' })
      setFakeHandler(req => {
        // Claude Code, lent only for web searches, is at its plan limit; everything else answers.
        if (req.grounded) throw new ProviderError('Your Claude plan’s usage limit is reached.', 'usage_limit')
        return fakeTeam(req)
      })
      const [id] = await createTasks([{ exec: 'sales', productId, task: 'Lent search limit test task', origin: 'cmo' }])
      const nightId = await startNight('manual', { onlyProducts: [productId] })
      nights.push(nightId)
      const night = await waitFor(async () => {
        const { data } = await db().from('nights').select('*').eq('id', nightId).single()
        return data?.status !== 'running' ? data : null
      }, 120_000)
      const log = night.log as Array<{ step: string; status: string; detail?: string }>
      expect(night.paused_reason).toBeNull()
      expect(log.find(e => e.step.includes('Lent search limit test task'))).toMatchObject({ status: 'skipped', detail: expect.stringMatching(/usage limit.*just this step is skipped.*rest of the night goes on/) })
      // The steps after it still ran: the execs' reports and the calendar.
      expect(log.filter(e => / report · /.test(e.step) && e.status === 'done').length).toBeGreaterThan(0)
      expect(log.find(e => e.step === 'Myra · your calendar')?.status).toBe('done')
      // The task waits for the reset.
      const { data: task } = await db().from('tasks').select('status').eq('id', id).single()
      expect(task!.status).toBe('queued')
      await db().from('tasks').delete().eq('id', id)
    } finally {
      if (before === undefined) delete process.env.MARKOS_MODEL_DEFAULT
      else process.env.MARKOS_MODEL_DEFAULT = before
    }
  })
})

describe('the brief written when the real one can’t be', () => {
  it('lists the steps that were skipped and never ran, not the waits that ended in a re-run', () => {
    const brief = fallbackBrief([
      { at: 't', step: 'Task · a web task', status: 'skipped', detail: 'Claude Code reached the Claude plan’s usage limit.' },
      { at: 't', step: 'Marketing · A', status: 'skipped', detail: 'Usage limit — waiting until 03:00' },
      { at: 't', step: 'Marketing · A', status: 'done' },
      { at: 't', step: 'Report · B', status: 'failed', detail: 'boom' },
    ], 'the brief couldn’t be written')
    expect(brief.risks).toEqual(['Report · B: boom', 'Task · a web task: Claude Code reached the Claude plan’s usage limit.'])
    expect(brief.overnight.map(o => o.summary)).toEqual(['Marketing · A'])
  })
})

describe('intake', () => {
  it('becomes the product profile and its claims rules become house rules', async () => {
    await confirmIntake(productId)
    const { data: p } = await db().from('products').select('*').eq('id', productId).single()
    expect(p!.intake_status).toBe('confirmed')
    expect(p!.target_geography).toBe('India')
    expect(p!.goals).toEqual(['10 design partners'])
    const { data: rules } = await db().from('house_rules').select('rule, origin').eq('product_id', productId)
    expect(rules).toContainEqual({ rule: 'Never say "guaranteed job"', origin: 'intake' })
  })
})

import { queueHandoffs, queueOwnMoves, WIP_LIMIT } from '@/lib/engine/execs/tasks'

describe('the team doesn’t drown itself in work', () => {
  it('nobody gets more than the work-in-progress limit from teammates or themselves', async () => {
    await db().from('tasks').delete().eq('exec', 'cfo').neq('origin', 'founder')
    const asks = Array.from({ length: 6 }, (_, i) => ({ to: 'cfo' as const, task: `WIP test ${i}`, why: 'test' }))
    await queueHandoffs(asks, { from: 'cmo', productId, nightId: null })
    const moves = Array.from({ length: 3 }, (_, i) => ({ mode: 'doing_it', task: `WIP own ${i}`, why_now: 'test' }))
    await queueOwnMoves('cfo', moves, { productId, nightId: null })
    const { count } = await db().from('tasks').select('id', { count: 'exact', head: true }).eq('exec', 'cfo').in('status', ['queued', 'running']).neq('origin', 'founder')
    expect(count).toBe(WIP_LIMIT)
    await db().from('tasks').delete().like('task', 'WIP %')
  })

  it('work for Myra that isn’t a meeting stays with whoever raised it', async () => {
    await queueHandoffs([{ to: 'ea', task: 'Export the task list for me', why: 'test' }], { from: 'coo', productId, nightId: null })
    const { data } = await db().from('tasks').select('exec').eq('task', 'Export the task list for me')
    expect(data ?? []).toEqual([])   // not given to Myra, and the COO doesn't hand work to itself
  })
})
