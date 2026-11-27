import { statSync } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { setModelOverrides, type AgentKey } from '@/lib/llm/models'
import type { Source } from '@/lib/llm/types'
import { loadBrain, renderBrief, type ProductRow } from '../brain'
import { normalizeUrl } from '../sources'
import { knownSources } from '../store'
import type { ExecKey } from '../schemas'
import { isSecretFile } from './repo-digest'

export type PortfolioProduct = Pick<ProductRow, 'id' | 'name' | 'url' | 'description'> & {
  repo_paths: string[]
  parent_id: string | null
  intake_status: string
  night_enabled: boolean
  last_deep_night: string | null
}

export async function portfolio(): Promise<PortfolioProduct[]> {
  const { data, error } = await db().from('products')
    .select('id, name, url, description, repo_paths, parent_id, intake_status, night_enabled, last_deep_night')
    .eq('status', 'active').order('created_at')
  if (error) throw new Error(`Could not read products: ${error.message}`)
  return (data ?? []) as PortfolioProduct[]
}

export function renderPortfolio(products: PortfolioProduct[]): string {
  const byId = new Map(products.map(p => [p.id, p]))
  return products.map(p => {
    const parent = p.parent_id ? byId.get(p.parent_id)?.name : null
    return `- ${p.name}${parent ? ` (part of ${parent})` : ''}: ${p.description ?? 'no description yet'}${p.repo_paths.length ? '' : ' [no code on this computer]'}`
  }).join('\n')
}

/** The context an exec works from: one product's brief, or the whole portfolio. */
export async function workContext(productId: string | null): Promise<{ text: string; readPaths: string[]; known: Source[] }> {
  const products = await portfolio()
  const { renderGoals } = await import('./goals')
  const goals = await renderGoals(productId)
  // The founder's real calendar — so nobody refers to a meeting that was moved or cancelled.
  const { data: meetings } = await db().from('meetings').select('title, scheduled_at, duration_min').eq('status', 'scheduled')
    .gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(5)
  const calendar = `## THE FOUNDER'S CALENDAR (current — only these meetings exist)\n${(meetings ?? []).map(m => `- ${new Date(m.scheduled_at as string).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}: ${m.title} (${m.duration_min} min)`).join('\n') || '- no meetings booked'}`
  if (!productId) {
    return {
      text: `${goals ? `${goals}\n\n` : ''}${calendar}\n\n## PORTFOLIO\n${renderPortfolio(products)}`,
      readPaths: products.flatMap(p => p.repo_paths),
      known: [],
    }
  }
  const [brain, known] = await Promise.all([loadBrain(productId), knownSources(productId)])
  const self = products.find(p => p.id === productId)
  return {
    text: `${goals ? `${goals}\n\n` : ''}${calendar}\n\n${renderBrief(brain)}\n\n## THE REST OF THE PORTFOLIO\n${renderPortfolio(products.filter(p => p.id !== productId))}`,
    readPaths: self?.repo_paths ?? [],
    known,
  }
}

function insideFolder(file: string, folder: string): boolean {
  const fold = (p: string) => (process.platform === 'win32' ? path.resolve(/*turbopackIgnore: true*/ p).toLowerCase() : path.resolve(/*turbopackIgnore: true*/ p))
  const rel = path.relative(fold(folder), fold(file))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** "src/a.ts:12", "src/a.ts:3-9" or "src/a.ts#L12" cite lines; the file itself is what must exist. */
const withoutLine = (value: string) => value.trim().replace(/#L\d+.*$/, '').replace(/(:\d+(-\d+)?)+$/, '')

/** A real file (not a folder) inside a folder the exec could read, and never a secret file: no exec may read those. */
function readableFile(file: string, readPaths: string[]): boolean {
  if (!readPaths.some(p => insideFolder(file, p)) || isSecretFile(file)) return false
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** A cited source is kept only if it's a retrieved page, or a real file inside a folder the exec could read. */
export function citationOk(value: string | null, known: Source[], readPaths: string[]): boolean {
  if (!value) return false
  // A file path, on any system (/repo/x on Mac and Linux, C:\repo\x on Windows): it must sit inside
  // a folder the exec could read, not merely start with the same letters (/repo2 isn't in /repo).
  if (path.isAbsolute(value.trim())) return readableFile(withoutLine(value), readPaths)
  // Or a path relative to one of those folders ("src/a.ts:12"): the code digest lists files that
  // way for an AI that can't open them. Anything with a scheme is a URL, checked as a source.
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())) {
    const rel = withoutLine(value)
    if (rel && readPaths.some(p => readableFile(path.resolve(/*turbopackIgnore: true*/ p, rel), readPaths))) return true
  }
  const norm = normalizeUrl(value)
  return known.some(s => normalizeUrl(s.url) === norm)
}

/** What an exec finished since its last report, so reports carry real continuity. */
export async function recentWork(exec: ExecKey, productId: string | null, since: Date): Promise<string> {
  let q = db().from('tasks').select('task, status, result_summary, error_message')
    .eq('exec', exec).gte('created_at', since.toISOString()).order('created_at').limit(20)
  q = productId ? q.eq('product_id', productId) : q.is('product_id', null)
  const { data } = await q
  if (!data?.length) return 'No tasks since the last report.'
  return data.map(t => `- [${t.status}] ${t.task}${t.result_summary ? ` → ${t.result_summary}` : ''}${t.error_message ? ` (failed: ${t.error_message})` : ''}`).join('\n')
}

export async function lastReport(exec: ExecKey, productId: string | null): Promise<{ headline: string; at: Date } | null> {
  let q = db().from('exec_reports').select('report, created_at').eq('exec', exec).order('created_at', { ascending: false }).limit(1)
  q = productId ? q.eq('product_id', productId) : q.is('product_id', null)
  const { data } = await q.maybeSingle()
  if (!data) return null
  return { headline: (data.report as { headline?: string })?.headline ?? '', at: new Date(data.created_at as string) }
}

/** Apply the founder's per-agent model choices from Settings before any AI work. */
export async function applyModelSettings() {
  const { data } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  setModelOverrides((data?.agent_models ?? {}) as Partial<Record<AgentKey, string>>)
}
