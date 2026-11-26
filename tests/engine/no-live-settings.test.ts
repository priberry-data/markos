import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The test suite shares the founder's real database. Writing their settings
// (the AI models, meeting windows, budgets) would change how the live app
// behaves while tests run — so no test may do it.
describe('tests leave the founder’s settings alone', () => {
  it('no test writes to profiles', () => {
    const files: string[] = []
    const walk = (d: string) => readdirSync(d).forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.test.ts') && files.push(p) })
    walk(resolve(__dirname, '..'))
    expect(files.filter(f => /from\('profiles'\)\s*\.update/.test(readFileSync(f, 'utf8')))).toEqual([])
  })
})
