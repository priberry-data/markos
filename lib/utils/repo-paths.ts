import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

// The folders a product's execs may read, as typed in Settings on any system: /Users/me/app on a
// Mac, /home/me/app on Linux, C:\Users\me\app (or C:/Users/me/app) on Windows.

/**
 * One typed folder as a clean full path, with ~ expanded; null when it isn't a full path. Quotes
 * around the whole path are dropped: Windows' "Copy as path" adds them.
 */
export function cleanRepoPath(raw: string): string | null {
  const typed = raw.trim().replace(/^(["'])(.*)\1$/, '$2').trim().replace(/^~(?=[\\/]|$)/, homedir())
  if (!typed || !path.isAbsolute(typed)) return null
  return path.resolve(/*turbopackIgnore: true*/ typed)
}

/** The folders to save, or the entries that aren't folders on this computer, as typed. */
export function checkRepoPaths(list: unknown[]): { ok: true; paths: string[] } | { ok: false; missing: string[] } {
  const paths: string[] = []
  const missing: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const full = cleanRepoPath(raw)
    let folder = false
    try {
      folder = full !== null && statSync(full).isDirectory()
    } catch { /* not there */ }
    if (folder) paths.push(full!)
    else missing.push(raw.trim())
  }
  return missing.length ? { ok: false, missing } : { ok: true, paths: [...new Set(paths)] }
}
