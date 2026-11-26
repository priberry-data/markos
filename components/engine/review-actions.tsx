'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, Sparkles } from 'lucide-react'

const input = 'bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'

/** Log a number only you know — PULSE uses it, never invents it. */
export function AddMetric({ productId }: { productId: string }) {
  const router = useRouter()
  const [m, setM] = useState({ metric: '', value: '', note: '' })
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const res = await fetch('/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, ...m }) })
    setBusy(false)
    if (!res.ok) return toast.error((await res.json()).error)
    toast.success('Recorded')
    setM({ metric: '', value: '', note: '' })
    router.refresh()
  }
  return (
    <div className="flex flex-wrap gap-2">
      <input className={`${input} flex-1 min-w-[140px]`} placeholder="e.g. Signups" value={m.metric} onChange={e => setM({ ...m, metric: e.target.value })} list="metric-names" />
      <datalist id="metric-names">{['Signups', 'Website visitors', 'Revenue', 'LinkedIn followers', 'X followers', 'Newsletter subscribers', 'Demo calls'].map(n => <option key={n} value={n} />)}</datalist>
      <input className={`${input} w-28`} placeholder="Value" type="number" value={m.value} onChange={e => setM({ ...m, value: e.target.value })} />
      <input className={`${input} flex-1 min-w-[140px]`} placeholder="Note (optional)" value={m.note} onChange={e => setM({ ...m, note: e.target.value })} />
      <button disabled={busy || !m.metric.trim() || m.value === ''} onClick={save} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
      </button>
    </div>
  )
}

/** Hand PULSE's proposed changes to SAGE as a new strategy draft for approval. */
export function ApplyChanges({ productId, changes }: { productId: string; changes: Array<{ area: string; change: string; why: string }> }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button disabled={busy} onClick={async () => {
      setBusy(true)
      const notes = `Apply these changes from the weekly review:\n${changes.map(c => `- ${c.area}: ${c.change} (because ${c.why})`).join('\n')}`
      const res = await fetch('/api/strategy/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, notes }) })
      setBusy(false)
      if (!res.ok) return toast.error((await res.json()).error)
      toast.success('SAGE is drafting a revised strategy — review it on the Strategy page')
      router.push('/strategy')
    }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white disabled:opacity-50">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Ask SAGE to apply these
    </button>
  )
}
