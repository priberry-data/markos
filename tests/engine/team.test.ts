import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { previewRoute } from '@/lib/engine/execs/route-preview'
import { systemFor } from '@/lib/engine/execs/roster'
import { ROLES } from '@/lib/engine/execs/roles'
import { CHARTER } from '@/lib/engine/charter'
import { EXEC_KEYS } from '@/lib/engine/schemas'

const PRODUCTS = [
  { id: '1', name: 'Acme Payroll' }, { id: '2', name: 'Northwind Hiring' },
  { id: '3', name: 'Fable Notes' }, { id: '4', name: 'Tidewater Research Labs' },
]

describe('who’s the boss', () => {
  it('every exec’s instructions start with the chain of command', () => {
    for (const e of EXEC_KEYS) expect(systemFor(e).startsWith(CHARTER), e).toBe(true)
  })

  it('no agent prompt in the engine is written without it', () => {
    // Any file that gives a model a system prompt must carry the charter
    // (directly, or through systemFor).
    const root = resolve(__dirname, '../../lib/engine')
    const files: string[] = []
    const walk = (d: string) => readdirSync(d).forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && files.push(p) })
    walk(root)
    const offenders = files.filter(f => {
      const src = readFileSync(f, 'utf8')
      // A prompt is `system:` followed by text or a constant — not an object like `system: { … }`.
      return /^\s*system:\s*[^{\s]/m.test(src) && !/CHARTER|systemFor\(/.test(src)
    })
    expect(offenders).toEqual([])
  })
})

describe('roles', () => {
  it('every seat has a written role, a boss and duties', () => {
    for (const key of ['founder', 'chief_of_staff', 'ea', ...EXEC_KEYS]) {
      const r = ROLES.find(x => x.key === key)
      expect(r, key).toBeTruthy()
      expect(r!.duties.length, key).toBeGreaterThan(0)
      expect(r!.reportsTo, key).toBeTruthy()
    }
    expect(ROLES.find(r => r.key === 'qa')!.reportsTo).toBe('CTO')
    expect(ROLES.find(r => r.key === 'cx')!.reportsTo).toBe('COO')
    expect(ROLES.find(r => r.key === 'ea')!.name).toBe('Myra')
  })
})

describe('live preview while typing or speaking', () => {
  it('lights up execs from English and Hinglish', () => {
    const seats = (t: string) => previewRoute(t, PRODUCTS).seats.map(s => s.seat)
    expect(seats('paisa kahan ja raha hai, check our pricing')).toContain('cfo')
    expect(seats('signup page is broken, kaam nahi kar raha')).toContain('qa')
    expect(seats('set up a meeting with the CFO tomorrow')).toEqual(expect.arrayContaining(['ea', 'cfo']))
    expect(seats('find 10 design partners for the beta')).toContain('sales')
  })

  it('lights up products by their names and nicknames', () => {
    const products = (t: string) => previewRoute(t, PRODUCTS).products.map(p => p.name)
    expect(products('payroll runs are slow this month')).toEqual(['Acme Payroll'])
    expect(products('northwind needs recruiters')).toEqual(['Northwind Hiring'])
    expect(products('launch post for fable notes')).toEqual(['Fable Notes'])
    expect(products('TRL fellowship applications')).toEqual(['Tidewater Research Labs'])
  })

  it('stays dark for nothing in particular', () => {
    expect(previewRoute('hello', PRODUCTS).seats).toEqual([])
  })
})

describe('no false lights', () => {
  it('“design partners” is sales, not product design', () => {
    const seats = previewRoute('Hiring ke liye 10 design partners chahiye', [{ id: '2', name: 'Northwind Hiring' }]).seats.map(s => s.seat)
    expect(seats).toContain('sales')
    expect(seats).not.toContain('cpo')
  })
})

import { CAPABILITIES } from '@/lib/engine/execs/roles'
import { EXECS } from '@/lib/engine/execs/roster'

describe('capabilities match the code', () => {
  it('every agent that searches the web or reads repos says so, and nothing claims a tool it lacks', () => {
    for (const k of EXEC_KEYS) {
      const tools = CAPABILITIES[k].tools.join(' ').toLowerCase()
      expect(tools.includes('web'), `${k} web`).toBe(EXECS[k].web)
      expect(/\brepos?\b/.test(tools), `${k} repo`).toBe(EXECS[k].repo)
    }
  })
})

import { isMeetingRequest } from '@/lib/engine/execs/tasks'

describe('Myra only books meetings', () => {
  it('tells a meeting from other work', () => {
    expect(isMeetingRequest('Set up time with the CFO about pricing')).toBe(true)
    expect(isMeetingRequest('Book a call with Sales on Friday')).toBe(true)
    expect(isMeetingRequest('CFO ke saath baithak rakho')).toBe(true)
    expect(isMeetingRequest('Export the current task list and approvals queue')).toBe(false)
  })
})
