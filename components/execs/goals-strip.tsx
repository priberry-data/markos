import Link from 'next/link'
import { Target } from 'lucide-react'
import { Avatar } from './team-card'
import { ConfirmGoals, ProposeGoals } from './goals-client'
import type { Goal } from '@/lib/engine/execs/goals'

// "What we're working toward" — the first thing on Home and in the room.

export function GoalsStrip({ goals, products, compact = false }: { goals: Goal[]; products: Map<string, string>; compact?: boolean }) {
  const active = goals.filter(g => g.status === 'active')
  const shown = active.length ? active : goals
  const proposed = !active.length && goals.length > 0
  const company = shown.find(g => !g.product_id)
  const rest = shown.filter(g => g.product_id)

  if (goals.length === 0) {
    return (
      <div className="bg-mk-card border border-dashed border-mk-line rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
        <Target className="w-5 h-5 text-mk-accent" />
        <p className="text-sm text-mk-body flex-1 min-w-[220px]"><b className="text-mk-text">No goals yet.</b> Without them the team can’t tell what matters most. Your Chief of Staff can draft them from your docs.</p>
        {!compact && <ProposeGoals />}
      </div>
    )
  }
  return (
    <div className="bg-mk-card border border-mk-line rounded-2xl p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Target className="w-5 h-5 text-mk-accent" />
        <p className="font-semibold text-mk-text">What we’re working toward</p>
        {proposed && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-mk-warn/15 text-mk-warn">drafted — waiting for you</span>}
        <Link href="/goals" className="ml-auto text-sm text-mk-accent hover:underline">{proposed ? 'Review' : 'Edit'} goals →</Link>
      </div>
      {company && (
        <div className="rounded-xl bg-mk-accent/10 border border-mk-accent/20 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-mk-accent-soft">The company goal</p>
          <p className="text-lg font-semibold text-mk-text">{company.title}</p>
          <Meta g={company} />
        </div>
      )}
      {!compact && rest.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2">
          {rest.map(g => (
            <div key={g.id} className="flex items-start gap-3 rounded-xl border border-mk-line px-3 py-2.5">
              {g.owner ? <Avatar seat={g.owner} size={28} /> : null}
              <div className="min-w-0">
                <p className="text-xs text-mk-accent-soft">{products.get(g.product_id!) ?? ''}</p>
                <p className="text-sm text-mk-text font-medium leading-snug">{g.title}</p>
                <Meta g={g} />
              </div>
            </div>
          ))}
        </div>
      )}
      {proposed && !compact && <div className="flex justify-end"><ConfirmGoals /></div>}
    </div>
  )
}

function Meta({ g }: { g: Goal }) {
  const pct = g.target && g.current !== null ? Math.min(100, Math.round((Number(g.current) / Number(g.target)) * 100)) : null
  // A server component renders once per request, so reading the clock here is safe.
  // eslint-disable-next-line react-hooks/purity
  const days = g.due ? Math.ceil((Date.parse(g.due) - Date.now()) / 86400_000) : null
  return (
    <div className="mt-1 space-y-1">
      <p className="text-xs text-mk-muted">
        {g.target ? `${g.current ?? '?'} of ${g.target}${g.unit ? ` ${g.unit}` : ''}` : g.metric ?? ''}
        {days !== null ? ` · ${days >= 0 ? `${days} days left` : `${-days} days overdue`}` : ''}
      </p>
      {pct !== null && <div className="h-1 rounded-full bg-mk-line overflow-hidden"><div className="h-full bg-mk-accent" style={{ width: `${pct}%` }} /></div>}
    </div>
  )
}
