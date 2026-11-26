'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Pencil, RotateCcw, Sparkles, Plus, X, Loader2 } from 'lucide-react'
import type { Strategy } from '@/lib/engine/schemas'
import { cn } from '@/lib/utils'

// The founder's checkpoint. Everything downstream is written from the strategy
// approved here, so every part of it is editable before approving.

interface Props {
  productId: string
  initial: Strategy
  status: 'draft' | 'approved'
  approvedAt: string | null
}

const card = 'bg-mk-card border border-mk-line rounded-2xl p-5'
const label = 'text-xs text-mk-muted uppercase tracking-wider mb-2'
const input =
  'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent resize-y'

function Field({ value, onChange, editing, rows = 2, className }: {
  value: string; onChange: (v: string) => void; editing: boolean; rows?: number; className?: string
}) {
  if (!editing) return <p className={cn('text-sm text-mk-body leading-relaxed whitespace-pre-wrap', className)}>{value}</p>
  return <textarea className={input} rows={rows} value={value} onChange={e => onChange(e.target.value)} />
}

/** A list of short strings — edited as one line per item. */
function Lines({ values, onChange, editing, empty = '—' }: {
  values: string[]; onChange: (v: string[]) => void; editing: boolean; empty?: string
}) {
  if (!editing) {
    return values.length ? (
      <ul className="space-y-1.5">
        {values.map((v, i) => (
          <li key={i} className="text-sm text-mk-body flex gap-2"><span className="text-mk-accent">•</span>{v}</li>
        ))}
      </ul>
    ) : <p className="text-sm text-mk-faint">{empty}</p>
  }
  return (
    <textarea
      className={input}
      rows={Math.max(3, values.length + 1)}
      value={values.join('\n')}
      // Keep blank lines while typing (so Enter starts a new item); they're
      // dropped when the strategy is saved.
      onChange={e => onChange(e.target.value.split('\n'))}
      placeholder="One per line"
    />
  )
}

export function StrategyEditor({ productId, initial, status, approvedAt }: Props) {
  const router = useRouter()
  const [s, setS] = useState<Strategy>(initial)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<null | 'approve' | 'revise'>(null)
  const [notes, setNotes] = useState('')
  const [showRevise, setShowRevise] = useState(false)
  const dirty = JSON.stringify(s) !== JSON.stringify(initial)

  const set = <K extends keyof Strategy>(key: K, value: Strategy[K]) => setS(prev => ({ ...prev, [key]: value }))

  async function approve() {
    setBusy('approve')
    try {
      const res = await fetch('/api/strategy/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, ...(dirty ? { strategy: cleanForSave(s) } : {}) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not approve')
      toast.success(body.runId ? 'Approved — the team is writing your content now' : 'Strategy approved')
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function revise() {
    if (!notes.trim()) return
    setBusy('revise')
    try {
      const res = await fetch('/api/strategy/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, notes }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not start the revision')
      toast.success('SAGE is revising the strategy — you’ll be notified when it’s ready')
      setShowRevise(false)
      setNotes('')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Checkpoint bar */}
      <div className={cn(
        'rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3 border',
        status === 'draft' ? 'bg-mk-warn/10 border-mk-warn/30' : 'bg-mk-ok/5 border-mk-ok/20'
      )}>
        <div className="flex-1 min-w-[240px]">
          {status === 'draft' ? (
            <>
              <p className="text-sm font-medium text-mk-warn">Draft — waiting for your approval</p>
              <p className="text-xs text-mk-muted mt-0.5">Nothing else is written until you approve. Edit anything first, or ask SAGE to revise.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-mk-ok">Approved{approvedAt ? ` on ${new Date(approvedAt).toLocaleDateString()}` : ''}</p>
              <p className="text-xs text-mk-muted mt-0.5">Every agent writes from this. Edits you save here apply to future work.</p>
            </>
          )}
        </div>
        {editing ? (
          <>
            <button onClick={() => { setS(initial); setEditing(false) }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text hover:bg-mk-line">
              <RotateCcw className="w-3.5 h-3.5" /> Discard edits
            </button>
            <button onClick={approve} disabled={busy !== null} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-60">
              {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {status === 'draft' ? 'Save & approve' : 'Save changes'}
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setShowRevise(v => !v)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text hover:bg-mk-line">
              <Sparkles className="w-3.5 h-3.5" /> Ask SAGE to revise
            </button>
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-text border border-mk-line hover:border-mk-accent">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            {status === 'draft' && (
              <button onClick={approve} disabled={busy !== null} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-60">
                {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Approve strategy
              </button>
            )}
          </>
        )}
      </div>

      {showRevise && !editing && (
        <div className={card}>
          <p className={label}>What should SAGE change?</p>
          <textarea
            className={input}
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. We only sell to recruitment agencies, not job seekers. Make the voice less corporate."
          />
          <div className="flex justify-end mt-3">
            <button onClick={revise} disabled={!notes.trim() || busy !== null} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white disabled:opacity-50">
              {busy === 'revise' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Revise
            </button>
          </div>
        </div>
      )}

      {/* Positioning */}
      <div className="bg-mk-card border border-mk-accent/25 rounded-2xl p-6 space-y-4">
        <div>
          <p className={label}>Positioning</p>
          <Field editing={editing} value={s.positioning_statement} onChange={v => set('positioning_statement', v)} rows={3} className="text-lg text-mk-text" />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <p className={label}>Tagline</p>
            <Field editing={editing} value={s.tagline} onChange={v => set('tagline', v)} rows={1} className="text-mk-text font-medium" />
          </div>
          <div>
            <p className={label}>Unique value</p>
            <Field editing={editing} value={s.unique_value} onChange={v => set('unique_value', v)} />
          </div>
        </div>
      </div>

      {/* Hero move */}
      <div className="bg-gradient-to-br from-mk-accent/15 to-mk-ok/5 border border-mk-accent/30 rounded-2xl p-6">
        <p className="text-xs text-mk-ok uppercase tracking-wider mb-2">Hero move — next 30 days</p>
        <Field editing={editing} value={s.hero_move.title} onChange={v => set('hero_move', { ...s.hero_move, title: v })} rows={1} className="text-lg font-semibold text-mk-text" />
        <div className="mt-2"><Field editing={editing} value={s.hero_move.description} onChange={v => set('hero_move', { ...s.hero_move, description: v })} rows={3} /></div>
        <div className="mt-2"><Field editing={editing} value={s.hero_move.why_now} onChange={v => set('hero_move', { ...s.hero_move, why_now: v })} className="text-xs text-mk-muted" /></div>
      </div>

      {/* Audience */}
      <div className={card}>
        <p className={label}>Audience</p>
        <Field editing={editing} value={s.audience.summary} onChange={v => set('audience', { ...s.audience, summary: v })} />
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {s.audience.segments.map((seg, i) => {
            const upd = (patch: Partial<typeof seg>) =>
              set('audience', { ...s.audience, segments: s.audience.segments.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4 space-y-3">
                <Field editing={editing} value={seg.name} onChange={v => upd({ name: v })} rows={1} className="font-medium text-mk-text" />
                <Field editing={editing} value={seg.description} onChange={v => upd({ description: v })} />
                <div><p className="text-xs text-mk-bad mb-1">Pains</p><Lines editing={editing} values={seg.pains} onChange={v => upd({ pains: v })} /></div>
                <div><p className="text-xs text-mk-ok mb-1">Motivations</p><Lines editing={editing} values={seg.motivations} onChange={v => upd({ motivations: v })} /></div>
                <div><p className="text-xs text-mk-warn mb-1">Objections</p><Lines editing={editing} values={seg.objections} onChange={v => upd({ objections: v })} /></div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Voice */}
      <div className={card}>
        <p className={label}>Voice</p>
        <Lines editing={editing} values={s.voice.tone} onChange={v => set('voice', { ...s.voice, tone: v })} />
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div><p className="text-xs text-mk-ok mb-1">Do</p><Lines editing={editing} values={s.voice.do} onChange={v => set('voice', { ...s.voice, do: v })} /></div>
          <div><p className="text-xs text-mk-bad mb-1">Don’t</p><Lines editing={editing} values={s.voice.dont} onChange={v => set('voice', { ...s.voice, dont: v })} /></div>
        </div>
        <div className="mt-4"><p className="text-xs text-mk-muted mb-1">Sounds like</p><Lines editing={editing} values={s.voice.sample_phrases} onChange={v => set('voice', { ...s.voice, sample_phrases: v })} /></div>
      </div>

      {/* Messaging */}
      <div className={card}>
        <p className={label}>Core message</p>
        <Field editing={editing} value={s.messaging.core_message} onChange={v => set('messaging', { ...s.messaging, core_message: v })} className="text-mk-text" />
        <div className="grid md:grid-cols-3 gap-3 mt-4">
          {s.messaging.pillars.map((p, i) => {
            const upd = (patch: Partial<typeof p>) =>
              set('messaging', { ...s.messaging, pillars: s.messaging.pillars.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4 space-y-2">
                <Field editing={editing} value={p.title} onChange={v => upd({ title: v })} rows={1} className="font-medium text-mk-text" />
                <Field editing={editing} value={p.message} onChange={v => upd({ message: v })} />
                <Field editing={editing} value={p.proof} onChange={v => upd({ proof: v })} className="text-xs text-mk-muted" />
              </div>
            )
          })}
        </div>
      </div>

      {/* Channels */}
      <div className={card}>
        <p className={label}>Channels</p>
        <div className="space-y-2">
          {s.channels.map((c, i) => {
            const upd = (patch: Partial<typeof c>) => set('channels', s.channels.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div key={i} className="flex flex-wrap items-start gap-3 bg-mk-bg border border-mk-line rounded-xl p-3">
                {editing ? (
                  <select value={c.priority} onChange={e => upd({ priority: e.target.value as typeof c.priority })} className="bg-mk-card border border-mk-line rounded-md text-xs text-mk-text px-2 py-1">
                    <option value="primary">primary</option><option value="secondary">secondary</option><option value="later">later</option>
                  </select>
                ) : (
                  <span className={cn('text-[10px] uppercase px-2 py-0.5 rounded-full',
                    c.priority === 'primary' ? 'bg-mk-accent/20 text-mk-accent-soft' : c.priority === 'secondary' ? 'bg-mk-ok/15 text-mk-ok' : 'bg-mk-line text-mk-muted')}>{c.priority}</span>
                )}
                <div className="flex-1 min-w-[200px] space-y-1">
                  <Field editing={editing} value={c.channel} onChange={v => upd({ channel: v })} rows={1} className="font-medium text-mk-text" />
                  <Field editing={editing} value={c.why} onChange={v => upd({ why: v })} />
                  <Field editing={editing} value={c.target_metric} onChange={v => upd({ target_metric: v })} rows={1} className="text-xs text-mk-muted" />
                </div>
                {editing && (
                  <button onClick={() => set('channels', s.channels.filter((_, j) => j !== i))} className="text-mk-faint hover:text-mk-bad"><X className="w-4 h-4" /></button>
                )}
              </div>
            )
          })}
          {editing && (
            <button onClick={() => set('channels', [...s.channels, { channel: 'New channel', priority: 'secondary', why: '', target_metric: '' }])} className="flex items-center gap-1.5 text-xs text-mk-accent">
              <Plus className="w-3.5 h-3.5" /> Add channel
            </button>
          )}
        </div>
      </div>

      {/* 90-day plan */}
      <div className={card}>
        <p className={label}>90-day plan</p>
        <div className="grid md:grid-cols-3 gap-3">
          {s.plan.map((phase, i) => {
            const upd = (patch: Partial<typeof phase>) => set('plan', s.plan.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4">
                <p className="text-xs text-mk-accent">{phase.weeks}</p>
                <Field editing={editing} value={phase.theme} onChange={v => upd({ theme: v })} rows={1} className="font-medium text-mk-text mt-1" />
                <ul className="mt-3 space-y-2">
                  {phase.weekly_goals.map((g, k) => (
                    <li key={k} className="text-sm flex gap-2">
                      <span className="text-mk-faint text-xs mt-0.5 w-10 shrink-0">Wk {g.week}</span>
                      <div className="flex-1">
                        <Field editing={editing} value={g.goal} rows={1}
                          onChange={v => upd({ weekly_goals: phase.weekly_goals.map((x, m) => (m === k ? { ...x, goal: v } : x)) })} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>

      {/* Objections */}
      <div className={card}>
        <p className={label}>Objections & answers</p>
        <div className="space-y-3">
          {s.objections.map((o, i) => {
            const upd = (patch: Partial<typeof o>) => set('objections', s.objections.map((x, j) => (j === i ? { ...x, ...patch } : x)))
            return (
              <div key={i} className="grid md:grid-cols-2 gap-3 bg-mk-bg border border-mk-line rounded-xl p-3">
                <Field editing={editing} value={o.objection} onChange={v => upd({ objection: v })} className="text-mk-warn" />
                <Field editing={editing} value={o.response} onChange={v => upd({ response: v })} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Drop blank list entries left over from editing before sending. */
function cleanForSave(s: Strategy): Strategy {
  const lines = (a: string[]) => a.map(x => x.trim()).filter(Boolean)
  return {
    ...s,
    audience: { ...s.audience, segments: s.audience.segments.map(x => ({ ...x, pains: lines(x.pains), motivations: lines(x.motivations), objections: lines(x.objections) })) },
    voice: { tone: lines(s.voice.tone), do: lines(s.voice.do), dont: lines(s.voice.dont), sample_phrases: lines(s.voice.sample_phrases) },
  }
}
