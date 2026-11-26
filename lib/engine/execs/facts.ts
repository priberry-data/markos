import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { db } from '@/lib/db'

// Facts the execs reason over, gathered by code — never by a model. A model
// that is told "these are the facts" and must cite them can't invent a commit
// count or a revenue figure; one asked to "look into the repo" can.

const run = promisify(execFile)

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', repo, ...args], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
    return stdout.trim()
  } catch {
    return ''
  }
}

export interface RepoFacts {
  path: string
  isGit: boolean
  lastCommit: string | null
  commitsSince: string[]
  filesChangedSince: number
  uncommittedFiles: number
  /** Notable files that signal unfinished work, if present. */
  flags: string[]
}

const FLAG_FILES = [
  'docs/PENDING_MIGRATIONS.sql', 'TODO.md', 'docs/TODO.md', 'KNOWN_ISSUES.md', 'docs/KNOWN_ISSUES.md',
  'docs/STATUS.md', 'docs/ROADMAP.md',
]

export async function repoFacts(path: string, since: Date): Promise<RepoFacts> {
  const isGit = existsSync(join(path, '.git'))
  if (!isGit) {
    return { path, isGit, lastCommit: null, commitsSince: [], filesChangedSince: 0, uncommittedFiles: 0, flags: [] }
  }
  const iso = since.toISOString()
  const [last, log, stat, status] = await Promise.all([
    git(path, ['log', '-1', '--date=short', '--pretty=%ad %s']),
    git(path, ['log', `--since=${iso}`, '--date=short', '--pretty=%h %ad %s', '-n', '60']),
    git(path, ['log', `--since=${iso}`, '--name-only', '--pretty=format:']),
    git(path, ['status', '--porcelain']),
  ])
  return {
    path,
    isGit,
    lastCommit: last || null,
    commitsSince: log ? log.split('\n') : [],
    filesChangedSince: new Set(stat.split('\n').filter(Boolean)).size,
    uncommittedFiles: status ? status.split('\n').length : 0,
    flags: FLAG_FILES.filter(f => existsSync(join(path, f))),
  }
}

export function renderRepoFacts(facts: RepoFacts[]): string {
  if (facts.length === 0) return 'No code for this product on this Mac — say so rather than guessing what it does.'
  return facts.map(f => !f.isGit ? `- ${f.path}: a folder, not a git repo` : [
    `- ${f.path}`,
    `  last commit: ${f.lastCommit ?? 'none'}`,
    `  commits since the last report: ${f.commitsSince.length}${f.commitsSince.length ? '\n' + f.commitsSince.slice(0, 40).map(c => `    ${c}`).join('\n') : ''}`,
    `  files changed since: ${f.filesChangedSince} · uncommitted files now: ${f.uncommittedFiles}`,
    f.flags.length ? `  files that track unfinished work: ${f.flags.join(', ')}` : null,
  ].filter(Boolean).join('\n')).join('\n')
}

/** Business facts from MarkOS's own records — the only numbers execs may state as fact. */
export async function businessFacts(productId: string | null, since: Date): Promise<string> {
  const supabase = db()
  const sinceIso = since.toISOString()
  // Each query is narrowed to the product when there is one (a helper that does
  // this generically sends TypeScript into an infinite type expansion).
  let metricsQ = supabase.from('metric_entries').select('metric, value, recorded_for, note')
  let contentQ = supabase.from('content_items').select('status, platform, scheduled_at')
  let outreachQ = supabase.from('outreach_targets').select('status, sent_at')
  let pipelineQ = supabase.from('pipeline').select('stage, kind')
  let spendQ = supabase.from('llm_calls').select('cost_usd, created_at')
  let tasksQ = supabase.from('tasks').select('exec, status, task, created_at')
  if (productId) {
    metricsQ = metricsQ.eq('product_id', productId)
    contentQ = contentQ.eq('product_id', productId)
    outreachQ = outreachQ.eq('product_id', productId)
    pipelineQ = pipelineQ.eq('product_id', productId)
    spendQ = spendQ.eq('product_id', productId)
    tasksQ = tasksQ.eq('product_id', productId)
  }
  const [metrics, content, outreach, pipeline, spend, tasks] = await Promise.all([
    metricsQ.order('recorded_for', { ascending: false }).limit(30),
    contentQ.in('status', ['draft', 'approved', 'posted']),
    outreachQ,
    pipelineQ,
    spendQ.gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
    tasksQ.gte('created_at', sinceIso),
  ])

  const count = <T,>(rows: T[] | null, key: (r: T) => string) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
    return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'
  }
  const upcoming = (content.data ?? []).filter(c => c.scheduled_at && new Date(c.scheduled_at) > new Date()).length
  const posted = (content.data ?? []).filter(c => c.status === 'posted').length
  const sent = (outreach.data ?? []).filter(o => o.sent_at).length
  const spent = (spend.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)

  return [
    `Founder-entered numbers (latest first): ${(metrics.data ?? []).length
      ? (metrics.data ?? []).map(m => `${m.metric}=${m.value} (${m.recorded_for}${m.note ? `, ${m.note}` : ''})`).join('; ')
      : 'none entered yet'}`,
    `Content: ${count(content.data, r => r.status as string)}; ${upcoming} scheduled ahead; ${posted} marked posted`,
    `Outreach: ${count(outreach.data, r => r.status as string)}; ${sent} emails actually sent`,
    `Sales pipeline: ${count(pipeline.data, r => r.stage as string)}`,
    `AI usage last 30 days (API-equivalent value, not billed on the Claude plan): $${spent.toFixed(2)}`,
    `Tasks since the last report: ${count(tasks.data, r => `${r.exec}:${r.status}`)}`,
  ].join('\n')
}
