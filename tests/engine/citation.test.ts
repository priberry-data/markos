import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { citationOk } from '@/lib/engine/execs/context'

// A cited file is kept only if it's a real file inside a folder the exec could read, on every system.
describe('file citations', () => {
  const repo = fs.mkdtempSync(path.join(tmpdir(), 'markos-repo-'))
  fs.mkdirSync(path.join(repo, 'docs'))
  fs.writeFileSync(path.join(repo, 'README.md'), '# x')
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# a')
  it('keeps a file inside a readable folder', () => {
    expect(citationOk(path.join(repo, 'README.md'), [], [repo])).toBe(true)
    expect(citationOk(`${repo}/docs/a.md`, [], [repo])).toBe(true)
  })
  it('keeps a line reference to a real file', () => {
    expect(citationOk(`${path.join(repo, 'README.md')}:12`, [], [repo])).toBe(true)
    expect(citationOk(`${path.join(repo, 'README.md')}:3-9`, [], [repo])).toBe(true)
  })
  it('drops a file that does not exist, even inside the folder', () => {
    expect(citationOk(path.join(repo, 'src', 'invented.ts'), [], [repo])).toBe(false)
  })
  it('drops a folder: a citation names a file', () => {
    expect(citationOk(path.join(repo, 'docs'), [], [repo])).toBe(false)
    expect(citationOk('docs', [], [repo])).toBe(false)
    expect(citationOk(repo, [], [repo])).toBe(false)
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

  // An AI that can't open files gets a digest listing them relative to the code folder, and cites them that way.
  it('keeps a path relative to a readable folder, with or without a line', () => {
    expect(citationOk('README.md', [], [repo])).toBe(true)
    expect(citationOk('docs/a.md:3', [], [repo])).toBe(true)
    expect(citationOk('docs/a.md#L3', [], [repo])).toBe(true)
    expect(citationOk(' README.md:3-9 ', [], [repo])).toBe(true)
  })
  it('drops a relative path when no folder could be read, or the file is not there', () => {
    expect(citationOk('README.md', [], [])).toBe(false)
    expect(citationOk('src/invented.ts', [], [repo])).toBe(false)
  })
  it('drops a relative path that climbs out of the folder, even to a real file', () => {
    const outer = fs.mkdtempSync(path.join(tmpdir(), 'markos-outer-'))
    const inner = path.join(outer, 'code')
    fs.mkdirSync(inner)
    fs.writeFileSync(path.join(outer, 'private.md'), 'not readable')
    expect(citationOk('../private.md', [], [inner])).toBe(false)
    expect(citationOk(path.join(outer, 'private.md'), [], [inner])).toBe(false)
  })
  it('never keeps a secret file, even one that exists inside the folder', () => {
    fs.writeFileSync(path.join(repo, '.env'), 'FAKE=1')
    fs.writeFileSync(path.join(repo, 'deploy.pem'), 'fake')
    expect(citationOk('.env', [], [repo])).toBe(false)
    expect(citationOk(path.join(repo, '.env'), [], [repo])).toBe(false)
    expect(citationOk('deploy.pem:1', [], [repo])).toBe(false)
  })
  it('still checks a URL against the pages the search returned, even if it looks like a file', () => {
    const known = [{ title: 'Readme', url: 'https://news.test/README.md' }]
    expect(citationOk('https://news.test/README.md', known, [repo])).toBe(true)
    expect(citationOk('https://news.test/README.md', [], [repo])).toBe(false)
  })
})
