import { db } from '@/lib/db'
import { pendingCounts } from '../status'
import type { ExecKey } from '../schemas'
import { businessFacts, renderRepoFacts, repoFacts } from './facts'
import { portfolio } from './context'
import { qaFacts } from './qa'
import { customerFacts } from './customers'
import { EXECS } from './roster'

// The facts each exec works from — gathered by code, the same for a report
// and for a task, so an exec never has to say "I can't see the data".

const DAY = 86400_000

/** MarkOS's own health: what failed, what was slow, what cost the most — counted from its records. */
async function platformFacts(since: Date): Promise<string> {
  const supabase = db()
  const iso = since.toISOString()
  const [{ data: calls }, { data: tasks }, { data: nights }] = await Promise.all([
    supabase.from('llm_calls').select('agent, purpose, model, status, error, latency_ms, cost_usd').gte('created_at', iso).limit(5000),
    supabase.from('tasks').select('exec, origin, status, error_message').gte('created_at', iso).limit(2000),
    supabase.from('nights').select('status, paused_reason, log').gte('started_at', iso).order('started_at', { ascending: false }).limit(7),
  ])
  const c = calls ?? []
  const errs = new Map<string, number>()
  for (const x of c.filter(x => x.status === 'error')) errs.set(`${x.agent}/${x.purpose}: ${String(x.error).slice(0, 90)}`, (errs.get(`${x.agent}/${x.purpose}: ${String(x.error).slice(0, 90)}`) ?? 0) + 1)
  const byPurpose = new Map<string, { n: number; ms: number; usd: number }>()
  for (const x of c) {
    const k = `${x.agent}/${x.purpose} (${x.model})`
    const v = byPurpose.get(k) ?? { n: 0, ms: 0, usd: 0 }
    v.n++; v.ms += Number(x.latency_ms ?? 0); v.usd += Number(x.cost_usd ?? 0)
    byPurpose.set(k, v)
  }
  const slow = [...byPurpose.entries()].sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n).slice(0, 6)
  const costly = [...byPurpose.entries()].sort((a, b) => b[1].usd - a[1].usd).slice(0, 6)
  const t = tasks ?? []
  const taskErrs = new Map<string, number>()
  for (const x of t.filter(x => x.status === 'failed' || x.status === 'cancelled')) {
    const k = `${x.status}: ${String(x.error_message ?? '').slice(0, 90)}`
    taskErrs.set(k, (taskErrs.get(k) ?? 0) + 1)
  }
  const nightSteps = (nights ?? []).flatMap(n => ((n.log ?? []) as Array<{ step: string; status: string; detail?: string }>).filter(l => l.status === 'failed'))
  return [
    `MarkOS's AI calls since the last report: ${c.length} (${c.filter(x => x.status === 'error').length} errors)`,
    `Errors by cause:\n${[...errs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `- ${n}× ${k}`).join('\n') || '- none'}`,
    `Slowest steps (average):\n${slow.map(([k, v]) => `- ${k}: ${Math.round(v.ms / v.n / 1000)}s × ${v.n}`).join('\n') || '- none'}`,
    `Most expensive steps (API-equivalent):\n${costly.map(([k, v]) => `- ${k}: $${v.usd.toFixed(2)} over ${v.n} calls`).join('\n') || '- none'}`,
    `Tasks: ${t.length} created; ${t.filter(x => x.status === 'done').length} done, ${t.filter(x => x.status === 'failed').length} failed, ${t.filter(x => x.status === 'cancelled').length} cancelled`,
    `Task failures and cancellations by cause:\n${[...taskErrs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `- ${n}× ${k}`).join('\n') || '- none'}`,
    `Night shifts: ${(nights ?? []).map(n => `${n.status}${n.paused_reason ? ` (${n.paused_reason})` : ''}`).join(', ') || 'none'}`,
    `Failed night steps:\n${nightSteps.slice(0, 8).map(l => `- ${l.step}: ${l.detail ?? ''}`).join('\n') || '- none'}`,
  ].join('\n\n')
}

export async function execFacts(exec: ExecKey, productId: string | null, since: Date, readPaths: string[]): Promise<string> {
  const parts: string[] = [await businessFacts(productId, since)]
  const supabase = db()

  if (EXECS[exec].repo) {
    const repos = await Promise.all(readPaths.map(p => repoFacts(p, since)))
    parts.push(`Repos (read-only; you may open files in them):\n${renderRepoFacts(repos)}`)
  }

  if (exec === 'cmo' && productId) {
    const [{ data: runs }, counts, { data: brain }] = await Promise.all([
      supabase.from('agent_runs').select('run_type, status, warnings, error_message, started_at')
        .eq('product_id', productId).gte('started_at', since.toISOString()).order('started_at'),
      pendingCounts(productId),
      supabase.from('product_brains').select('strategy_status, strategy_approved_at').eq('product_id', productId).maybeSingle(),
    ])
    parts.push(`Strategy: ${brain?.strategy_status ?? 'none'}${brain?.strategy_approved_at ? ` (approved ${String(brain.strategy_approved_at).slice(0, 10)})` : ''}`)
    parts.push(`Waiting for the founder: ${counts.content} content drafts, ${counts.outreach} outreach targets${counts.strategy ? ', a strategy to approve' : ''}`)
    parts.push(`Team runs since the last report:\n${(runs ?? []).map(r => `- ${r.run_type}: ${r.status}${r.error_message ? ` — ${r.error_message}` : ''}${(r.warnings as string[] | null)?.length ? ` (warnings: ${(r.warnings as string[]).join('; ')})` : ''}`).join('\n') || '- none'}`)
  }

  if (exec === 'sales' && productId) {
    const { data: rows } = await supabase.from('pipeline').select('name, kind, stage, next_step, last_contacted_at, verified')
      .eq('product_id', productId).not('stage', 'in', '(lost,dropped)').order('updated_at', { ascending: false }).limit(40)
    const stale = (rows ?? []).filter(r => r.stage === 'contacted' && r.last_contacted_at && Date.now() - new Date(r.last_contacted_at).getTime() > 5 * DAY)
    parts.push(`Pipeline:\n${(rows ?? []).map(r => `- ${r.name} (${r.kind}, ${r.stage}${r.verified ? '' : ', unverified'})${r.next_step ? ` next: ${r.next_step}` : ''}`).join('\n') || '- empty'}`)
    if (stale.length) parts.push(`Contacted over 5 days ago with no reply recorded: ${stale.map(r => r.name).join(', ')}`)
  }

  if (exec === 'qa' && productId) parts.push(await qaFacts(productId))
  if (exec === 'cx' && productId) parts.push(await customerFacts(productId))
  if ((exec === 'cto' || exec === 'cpo') && productId) {
    const { data: open } = await supabase.from('issues').select('title, severity, origin').eq('product_id', productId).eq('status', 'open').limit(20)
    parts.push(`Open issues (from QA, live checks and customers):\n${(open ?? []).map(i => `- [${i.severity}] ${i.title} (${i.origin})`).join('\n') || '- none'}`)
  }

  if (exec === 'data') {
    const { dataConnections } = await import('./data-team')
    const conns = await dataConnections()
    parts.push(`Database connections:\n${conns.map(c => `- ${c.name}: ${c.connected ? 'connected (read-only)' : `not connected — needs ${c.envVar} in .env.local`}`).join('\n')}`)
    if (productId) {
      const { data: computed } = await supabase.from('metric_entries').select('metric, value, recorded_for, note')
        .eq('product_id', productId).like('note', 'Data team%').order('created_at', { ascending: false }).limit(20)
      parts.push(`Numbers you computed recently:\n${(computed ?? []).map(m => `- ${m.metric} = ${m.value} (${m.recorded_for})`).join('\n') || '- none yet'}`)
    }
  }

  if (exec === 'platform') parts.push(await platformFacts(since))

  if (exec === 'coo') {
    const [{ data: open }, products] = await Promise.all([
      supabase.from('tasks').select('exec, task, status, due, created_at, product_id').in('status', ['queued', 'running', 'failed']).order('created_at').limit(40),
      portfolio(),
    ])
    const name = new Map(products.map(p => [p.id, p.name]))
    const today = new Date().toISOString().slice(0, 10)
    parts.push(`Open or failed tasks:\n${(open ?? []).map(t => `- ${t.exec} · ${t.product_id ? name.get(t.product_id) : 'portfolio'} · ${t.status}${t.due ? ` · due ${t.due}${t.due < today ? ' (OVERDUE)' : ''}` : ''}: ${t.task}`).join('\n') || '- none'}`)
    const waiting = await Promise.all(products.map(async p => ({ p, c: await pendingCounts(p.id) })))
    parts.push(`Waiting on the founder, per product:\n${waiting.map(({ p, c }) => `- ${p.name}: ${c.content} drafts, ${c.outreach} outreach, ${c.strategy ? 'strategy to approve' : 'no strategy waiting'}; intake ${p.intake_status}`).join('\n')}`)
  }

  return parts.join('\n\n')
}

