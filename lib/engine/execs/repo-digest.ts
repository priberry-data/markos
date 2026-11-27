import { execFile } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

// What the team knows about a product's code when its AI can't open files
// itself (everything except Claude Code). MarkOS reads it, read-only: the file
// list, the README and the project files, capped in size. Secret files are never
// read or listed — the same ones Claude Code is denied (.env*, keys) — and in a git
// repository nothing git ignores is either, even when the folder is a subfolder of it.

const run = promisify(execFile)

const DOC_FILES = [
  'README.md', 'README', 'readme.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'composer.json', 'Gemfile',
  'CHANGELOG.md', 'TODO.md', 'ROADMAP.md', 'docs/README.md',
]
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__', 'target', 'vendor', '.turbo', 'coverage'])
const MAX_FILES = 400
const MAX_LIST_CHARS = 12_000
const MAX_DOC = 6000
// The whole digest, file lists included (~10k tokens): it has to fit a local model's window.
const MAX_TOTAL = 40_000

/** Never read or list these, in any folder. */
export function isSecretFile(file: string): boolean {
  const base = path.basename(file).toLowerCase()
  return base.startsWith('.env') || base.endsWith('.pem') || base.endsWith('.key') || base.startsWith('id_rsa') || base.startsWith('id_ed25519')
    || /(^|[._-])(secret|secrets|credentials?)([._-]|$)/.test(base)
}

/**
 * Is this folder in a git repository: a .git in it or in any folder above it? Looked for from
 * the folder's real path, as git does: a product folder reached through a link (or a Windows
 * junction) belongs to the repository the link leads into, not to the folders around the link.
 */
function inGitRepo(root: string): boolean {
  let start: string
  try { start = realpathSync(root) } catch { start = path.resolve(/*turbopackIgnore: true*/ root) }
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git'))) return true
    if (path.dirname(dir) === dir) return false
  }
}

/**
 * The folder's files, relative to it. In a git repository, git says which: the files it tracks
 * plus new ones it doesn't ignore, never what .gitignore hides (null when git won't run there,
 * because MarkOS won't guess which files are ignored). Anywhere else, a short walk.
 */
async function listFiles(root: string): Promise<{ files: string[]; git: boolean } | null> {
  if (inGitRepo(root)) {
    try {
      // -z: names exactly as they are, never quoted, so the secret-file check sees the real name.
      const { stdout } = await run('git', [
        '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard',
        ...[...SKIP_DIRS].map(d => `--exclude=${d}/`),
      ], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })
      return { files: stdout.split('\0').filter(Boolean), git: true }
    } catch {
      return null
    }
  }
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || out.length >= MAX_FILES * 2) return
    let entries: import('node:fs').Dirent[]
    try { entries = readdirSync(path.join(root, dir), { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name
      // Links are neither listed nor followed: one could point anywhere.
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(rel, depth + 1) }
      else if (e.isFile()) out.push(rel)
    }
  }
  walk('', 0)
  return { files: out, git: false }
}

/** The project files to read, matched without regard to case, each once. */
function projectFiles(root: string, listed: { files: string[]; git: boolean }): string[] {
  const byName = new Map<string, string>()
  const add = (f: string) => { if (!byName.has(f.toLowerCase())) byName.set(f.toLowerCase(), f) }
  if (listed.git) {
    // Only files on git's list, so nothing git ignores is ever read.
    for (const f of listed.files) add(f)
  } else {
    // Not a repository: look for them directly, since a big folder's walk may stop before docs/.
    for (const dir of ['', 'docs']) {
      try {
        for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) if (e.isFile()) add(dir ? `${dir}/${e.name}` : e.name)
      } catch { /* no such folder */ }
    }
  }
  return [...new Set(DOC_FILES.map(d => byName.get(d.toLowerCase())).filter((f): f is string => Boolean(f)))]
}

/** A plain file inside the folder, never a link (one could point at a secret) and never a secret. */
function readProjectFile(root: string, rel: string, max: number): string | null {
  const full = path.join(root, rel)
  try {
    if (!lstatSync(full).isFile()) return null
    const inside = path.relative(realpathSync(root), realpathSync(full))
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || isSecretFile(inside)) return null
    return readFileSync(full, 'utf8').slice(0, max)
  } catch {
    return null
  }
}

export async function repoDigest(paths: string[]): Promise<string> {
  const parts: string[] = []
  let total = 0
  for (const root of paths) {
    if (!existsSync(root)) { parts.push(`### ${root}\n(this folder no longer exists)`); continue }
    if (total >= MAX_TOTAL) { parts.push(`### ${root}\n(left out: the digest is full)`); continue }
    const listed = await listFiles(root)
    if (!listed) {
      parts.push(`### ${root}\n(MarkOS read nothing here: this folder is in a git repository but git wouldn’t run, so it can’t tell which files git ignores. Install git, or check \`git status\` works in this folder.)`)
      continue
    }
    const files = listed.files.filter(f => !isSecretFile(f))
    const budget = Math.min(MAX_LIST_CHARS, MAX_TOTAL - total)
    const shown: string[] = []
    let used = 0
    for (const f of files.slice(0, MAX_FILES)) {
      if (used + f.length + 1 > budget) break
      shown.push(f)
      used += f.length + 1
    }
    total += used
    parts.push(`### ${root}\nFiles (${files.length}${files.length > shown.length ? `, first ${shown.length} shown` : ''}):\n${shown.join('\n')}`)
    // Matched without regard to case, once each: on a Mac or Windows disk README.md and readme.md
    // are the same file.
    for (const doc of projectFiles(root, { ...listed, files })) {
      if (total >= MAX_TOTAL) break
      const text = readProjectFile(root, doc, Math.min(MAX_DOC, MAX_TOTAL - total))
      if (text === null) continue
      total += text.length
      parts.push(`--- ${path.join(root, doc)} ---\n${text}`)
    }
  }
  return parts.join('\n\n')
}

/** The block that replaces "you may read files under ..." for an AI that can't open files. */
export async function repoDigestBlock(paths: string[]): Promise<string> {
  if (!paths.length) return ''
  return `## THE CODE (read by MarkOS just now: the file list and key project files — you cannot open other files, so don't claim to have read them)\n${await repoDigest(paths)}`
}
