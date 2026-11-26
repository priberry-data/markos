import Link from 'next/link'
import { db } from '@/lib/db'
import { AGENTS, type AgentKey } from '@/lib/llm/models'
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle, AlertTriangle, MessageSquareQuote } from 'lucide-react'
import { StopRunButton } from './stop-run-button'
import { cn } from '@/lib/utils'

const ORDER: AgentKey[] = ['research', 'strategy', 'content', 'search', 'distribution', 'pr', 'ads', 'investor', 'creative', 'director']

const STEP_ICON = {
  queued: <Circle className="w-4 h-4 text-mk-faint" />,
  running: <Loader2 className="w-4 h-4 text-mk-accent animate-spin" />,
  done: <CheckCircle2 className="w-4 h-4 text-mk-ok" />,
  failed: <XCircle className="w-4 h-4 text-mk-bad" />,
  skipped: <MinusCircle className="w-4 h-4 text-mk-faint" />,
} as const

const RUN_TITLE: Record<string, string> = {
  running: 'The team is working',
  awaiting_approval: 'Waiting for your approval',
  completed: 'Finished',
  completed_with_warnings: 'Finished — with notes',
  failed: 'Stopped with a problem',
  cancelled: 'Stopped',
}

/** The latest run: every agent's status, what ARIA sent back, cost, warnings. */
export async function RunPanel({ productId }: { productId: string }) {
  const supabase = db()
  const { data: run } = await supabase.from('agent_runs').select('*').eq('product_id', productId)
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!run) return null

  // Server component: renders once per request, so reading the clock here is fine.
  // eslint-disable-next-line react-hooks/purity
  const finishedLongAgo = run.completed_at && Date.now() - new Date(run.completed_at).getTime() > 3 * 24 * 3600 * 1000
  if (finishedLongAgo && run.status === 'completed') return null

  const [{ data: steps }, { data: calls }, { data: reviews }] = await Promise.all([
    supabase.from('run_steps').select('agent, status, detail').eq('run_id', run.id),
    supabase.from('llm_calls').select('cost_usd').eq('run_id', run.id),
    supabase.from('agent_reviews').select('agent, verdict, revised, issues').eq('run_id', run.id),
  ])
  const cost = (calls ?? []).reduce((s, c) => s + Number(c.cost_usd ?? 0), 0)
  const ordered = (steps ?? []).sort((a, b) => ORDER.indexOf(a.agent as AgentKey) - ORDER.indexOf(b.agent as AgentKey))
  const active = run.status === 'running'
  const warnings = (run.warnings ?? []) as string[]

  return (
    <div className={cn('rounded-2xl border p-5', active ? 'bg-mk-accent/5 border-mk-accent/30'
      : run.status === 'failed' ? 'bg-mk-bad/5 border-mk-bad/30'
      : run.status === 'awaiting_approval' ? 'bg-mk-warn/5 border-mk-warn/30' : 'bg-mk-card border-mk-line')}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-semibold text-mk-text">{RUN_TITLE[run.status] ?? run.status}</p>
        <span className="text-xs text-mk-muted">started {new Date(run.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · cost ≈ ${cost.toFixed(3)}</span>
        <div className="ml-auto flex items-center gap-2">
          {run.status === 'awaiting_approval' && <Link href="/strategy" className="px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-warn/20 text-mk-warn">Review strategy →</Link>}
          {(active || run.status === 'awaiting_approval') && <StopRunButton productId={productId} />}
        </div>
      </div>
      {run.error_message && run.status !== 'cancelled' && (
        <p className="text-sm text-mk-bad mt-2">{run.error_message}</p>
      )}
      {ordered.length > 0 && (
        <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {ordered.map(s => {
            const a = AGENTS[s.agent as AgentKey]
            return (
              <li key={s.agent} className="flex items-start gap-2">
                {STEP_ICON[s.status as keyof typeof STEP_ICON] ?? STEP_ICON.queued}
                <div className="min-w-0">
                  <p className="text-sm text-mk-text">{a?.name ?? s.agent} <span className="text-mk-muted">· {a?.title ?? ''}</span></p>
                  {s.detail && <p className={cn('text-xs', s.status === 'failed' ? 'text-mk-bad' : 'text-mk-muted')}>{s.detail}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {(reviews ?? []).some(r => r.verdict === 'revise') && (
        <div className="mt-4 pt-4 border-t border-mk-line space-y-2">
          {(reviews ?? []).filter(r => r.verdict === 'revise').map(r => (
            <div key={r.agent} className="flex gap-2 text-xs">
              <MessageSquareQuote className="w-4 h-4 text-mk-accent-soft shrink-0" />
              <p className="text-mk-body">
                <span className="text-mk-accent-soft">ARIA → {AGENTS[r.agent as AgentKey]?.name}:</span>{' '}
                {((r.issues ?? []) as Array<{ problem: string }>).slice(0, 2).map(i => i.problem).join(' · ')}
                {r.revised ? <span className="text-mk-ok"> — revised</span> : <span className="text-mk-warn"> — not revised</span>}
              </p>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-4 pt-4 border-t border-mk-line space-y-1">
          {warnings.map((w, i) => <li key={i} className="flex gap-2 text-xs text-mk-warn"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</li>)}
        </ul>
      )}
    </div>
  )
}
