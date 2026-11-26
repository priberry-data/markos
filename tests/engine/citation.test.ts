import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { citationOk } from '@/lib/engine/execs/context'

// A cited file is kept only if it's inside a folder the exec could read, on every system.
describe('file citations', () => {
  const repo = path.join(tmpdir(), 'markos-repo')
  it('keeps a file inside a readable folder', () => {
    expect(citationOk(path.join(repo, 'README.md'), [], [repo])).toBe(true)
    expect(citationOk(`${repo}/docs/a.md`, [], [repo])).toBe(true)
  })
  it('drops a file in a folder that only starts with the same name', () => {
    expect(citationOk(path.join(`${repo}2`, 'secret.md'), [], [repo])).toBe(false)
  })
  it('drops a file outside every readable folder', () => {
    expect(citationOk(path.join(tmpdir(), 'other', 'x.md'), [], [repo])).toBe(false)
  })
  it('drops a page the search never returned', () => {
    expect(citationOk('https://invented.test/z', [], [repo])).toBe(false)
  })
})
