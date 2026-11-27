import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkRepoPaths, cleanRepoPath } from '@/lib/utils/repo-paths'

// The product folders typed in Settings, checked against real folders, so the Windows job in CI
// proves a Windows path (C:\...) saves, not only a Mac or Linux one.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-folder-'))
const file = path.join(dir, 'notes.txt')
fs.writeFileSync(file, 'not a folder')
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('product folders', () => {
  it('saves a real folder written the way this system writes paths', () => {
    // On Windows this is C:\Users\...\Temp\markos-folder-…: a full path that doesn't start with "/".
    expect(checkRepoPaths([dir])).toEqual({ ok: true, paths: [path.resolve(dir)] })
    // A trailing separator, spaces around it, and the same folder twice: saved once.
    expect(checkRepoPaths([`${dir}${path.sep}`, ` ${dir} `])).toEqual({ ok: true, paths: [path.resolve(dir)] })
  })

  it('takes forward slashes on Windows too', () => {
    expect(cleanRepoPath(dir.split(path.sep).join('/'))).toBe(path.resolve(dir))
  })

  it('drops the quotes Windows’ “Copy as path” puts around a path', () => {
    expect(checkRepoPaths([`"${dir}"`])).toEqual({ ok: true, paths: [path.resolve(dir)] })
    expect(checkRepoPaths([` '${dir}' `])).toEqual({ ok: true, paths: [path.resolve(dir)] })
    expect(cleanRepoPath('"projects/app"')).toBeNull()
  })

  it('expands ~ to the home folder', () => {
    expect(cleanRepoPath('~')).toBe(path.resolve(os.homedir()))
    expect(cleanRepoPath(`~${path.sep}projects`)).toBe(path.join(os.homedir(), 'projects'))
  })

  it('refuses relative paths, files and folders that aren’t there, and ignores blanks', () => {
    expect(cleanRepoPath('projects/app')).toBeNull()
    expect(checkRepoPaths(['projects/app', file, path.join(dir, 'missing'), '', '  ', 42])).toEqual({
      ok: false, missing: ['projects/app', file, path.join(dir, 'missing')],
    })
    expect(checkRepoPaths([])).toEqual({ ok: true, paths: [] })
  })
})
