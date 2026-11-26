'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Sparkles } from 'lucide-react'
import { tone } from '@/components/engine/ui'
import { cn } from '@/lib/utils'
import { EXEC_LABELS } from '@/lib/engine/execs/people'
import type { Goal } from '@/lib/engine/execs/goals'

async function api(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
  return json
}

function useAct() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  return {
    busy,
    act: async (key: string, fn: () => Promise<unknown>, ok?: string) => {
      setBusy(key)
      try { await fn(); if (ok) toast.success(ok); router.refresh() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
    },
  }
}

export function ProposeGoals({ again }: { again?: boolean }) {
  const { busy, act } = useAct()
  return (
    <button className={again ? tone.ghostBtn : tone.primaryBtn} disabled={busy !== null}
      onClick={() => act('p', () => api('/api/goals', 'POST', { action: 'propose' }), 'Your Chief of Staff drafted goals from your docs')}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {again ? 'Draft again' : 'Draft goals from my docs'}
    </button>
  )
}

export function ConfirmGoals() {
  const { busy, act } = useAct()
  return (
    <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-ok text-white hover:opacity-90 disabled:opacity-50" disabled={busy !== null}
      onClick={() => act('c', () => api('/api/goals', 'POST', { action: 'confirm' }), 'Goals confirmed — the whole team now works toward them')}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirm these goals
    </button>
  )
}

/** One goal, editable in place: the number, the target, the date, the owner, or its status. */
export function GoalRow({ g, productName }: { g: Goal; productName: string | null }) {
  const { busy, act } = useAct()
  const [v, setV] = useState({ title: g.title, current: g.current ?? '', target: g.target ?? '', due: g.due ?? '', owner: g.owner ?? '' })
  const dirty = v.title !== g.title || String(v.current) !== String(g.current ?? '') || String(v.target) !== String(g.target ?? '') || v.due !== (g.due ?? '') || v.owner !== (g.owner ?? '')
  const pct = g.target && g.current !== null ? Math.min(100, Math.round((Number(g.current) / Number(g.target)) * 100)) : null
  return (
    <div className={cn(tone.inset, 'px-4 py-3 space-y-2')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-mk-accent-soft">{productName ?? 'Company'}</span>
        {g.status === 'proposed' && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-mk-warn/15 text-mk-warn">proposed</span>}
        {g.status === 'achieved' && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-mk-ok/15 text-mk-ok">achieved</span>}
        <select value={g.status} disabled={busy !== null} onChange={e => act('s', () => api(`/api/goals/${g.id}`, 'PATCH', { status: e.target.value }), 'Updated')}
          className="ml-auto bg-mk-card border border-mk-line rounded-lg px-2 py-1 text-xs text-mk-body">
          <option value="proposed">proposed</option><option value="active">active</option><option value="achieved">achieved</option><option value="dropped">drop it</option>
        </select>
      </div>
      <input className={cn(tone.input, 'font-medium')} value={v.title} onChange={e => setV({ ...v, title: e.target.value })} />
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="w-24"><span className="block text-mk-muted mb-1">Now</span><input className={tone.input} value={v.current} onChange={e => setV({ ...v, current: e.target.value })} placeholder="?" /></label>
        <label className="w-24"><span className="block text-mk-muted mb-1">Target</span><input className={tone.input} value={v.target} onChange={e => setV({ ...v, target: e.target.value })} /></label>
        <label className="w-36"><span className="block text-mk-muted mb-1">By</span><input type="date" className={tone.input} value={v.due} onChange={e => setV({ ...v, due: e.target.value })} /></label>
        <label className="w-36"><span className="block text-mk-muted mb-1">Owner</span>
          <select className={tone.input} value={v.owner} onChange={e => setV({ ...v, owner: e.target.value })}>
            <option value="">—</option>{Object.entries(EXEC_LABELS).filter(([k]) => k !== 'ea').map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select></label>
        {dirty && <button className={tone.primaryBtn} disabled={busy !== null} onClick={() => act('e', () => api(`/api/goals/${g.id}`, 'PATCH', v), 'Saved')}>Save</button>}
      </div>
      {pct !== null && <div className="h-1.5 rounded-full bg-mk-line overflow-hidden"><div className="h-full bg-mk-accent" style={{ width: `${pct}%` }} /></div>}
      {g.metric && <p className="text-xs text-mk-muted">Counts: {g.metric}{g.why ? ` · Why: ${g.why}` : ''}</p>}
    </div>
  )
}

export function AddGoal({ products }: { products: Array<{ id: string; name: string }> }) {
  const { busy, act } = useAct()
  const [v, setV] = useState({ title: '', product_id: '', target: '', due: '', owner: '' })
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex-1 min-w-[220px]"><span className="block text-xs text-mk-muted mb-1">A goal of your own</span>
        <input className={tone.input} value={v.title} onChange={e => setV({ ...v, title: e.target.value })} placeholder="e.g. 500 paying users" /></label>
      <select className="bg-mk-card border border-mk-line rounded-lg px-2 py-2 text-sm text-mk-body" value={v.product_id} onChange={e => setV({ ...v, product_id: e.target.value })}>
        <option value="">Whole company</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className={cn(tone.input, 'w-24')} value={v.target} onChange={e => setV({ ...v, target: e.target.value })} placeholder="Target" />
      <input type="date" className={cn(tone.input, 'w-40')} value={v.due} onChange={e => setV({ ...v, due: e.target.value })} />
      <button className={tone.primaryBtn} disabled={busy !== null || !v.title.trim()}
        onClick={() => act('a', async () => { await api('/api/goals', 'POST', { action: 'add', ...v }); setV({ title: '', product_id: '', target: '', due: '', owner: '' }) }, 'Goal added')}>
        <Plus className="w-4 h-4" /> Add
      </button>
    </div>
  )
}
