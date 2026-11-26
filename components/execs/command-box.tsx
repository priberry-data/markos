'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { tone } from '@/components/engine/ui'
import { cn } from '@/lib/utils'
import { previewRoute, type ProductRef, type Seat } from '@/lib/engine/execs/route-preview'
import { DICTATION_LANGS, useDictation } from './use-dictation'

// The one place the founder talks to the company — by typing or by voice.
// As the instruction takes shape, the team on the side lights up: instantly
// from what's said, then — when the founder pauses — from the Chief of
// Staff's reading of what's meant, with the reason each exec was picked.

const TEAM: Array<{ seat: Seat; name: string; role: string }> = [
  { seat: 'cmo', name: 'CMO', role: 'Marketing' },
  { seat: 'sales', name: 'Sales', role: 'Customers & partners' },
  { seat: 'cfo', name: 'CFO', role: 'Money & pricing' },
  { seat: 'data', name: 'Data', role: 'Numbers & analysis' },
  { seat: 'cpo', name: 'CPO', role: 'Product' },
  { seat: 'cto', name: 'CTO', role: 'Engineering' },
  { seat: 'qa', name: 'QA', role: 'Bugs & quality' },
  { seat: 'platform', name: 'Platform', role: 'Fixing MarkOS itself' },
  { seat: 'cx', name: 'Customer team', role: 'Talking to users' },
  { seat: 'coo', name: 'COO', role: 'Operations' },
  { seat: 'ea', name: 'Myra', role: 'Your calendar' },
]

type Semantic = { seats: Array<{ seat: Seat; why: string }>; products: ProductRef[] }

export function CommandBox({ products }: { products: ProductRef[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const dictation = useDictation(t => setText(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${t}`))
  const { listening, interim, lang, setLang } = dictation
  const [semantic, setSemantic] = useState<Semantic | null>(null)
  const [reading, setReading] = useState(false)
  const [semanticError, setSemanticError] = useState<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  const readFor = useRef('')

  const live = `${text}${interim ? ` ${interim}` : ''}`.trim()
  const instant = useMemo(() => previewRoute(live, products), [live, products])

  // Semantic reading once the founder pauses for a moment.
  useEffect(() => {
    setSemantic(prev => (prev && readFor.current && live.startsWith(readFor.current) ? prev : null))
    if (live.length < 12) { setReading(false); return }
    const t = setTimeout(async () => {
      pending.current?.abort()
      const ctrl = new AbortController()
      pending.current = ctrl
      setReading(true)
      try {
        const res = await fetch('/api/directives/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: live }), signal: ctrl.signal })
        const json = await res.json()
        if (!res.ok) { setSemanticError(json.error ?? 'unavailable'); return }
        readFor.current = live
        setSemantic(json)
        setSemanticError(null)
      } catch {
        // superseded by a newer reading
      } finally {
        if (pending.current === ctrl) setReading(false)
      }
    }, 1400)
    return () => clearTimeout(t)
  }, [live])

  const toggleMic = dictation.toggle

  async function send() {
    if (!live) return
    dictation.stop()
    setBusy(true)
    try {
      const res = await fetch('/api/directives', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: live }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      setText(''); setSemantic(null)
      toast.success('Your Chief of Staff is routing it')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Which seats are lit, and how strongly.
  const lit = new Map<Seat, { level: 'guess' | 'sure'; why: string }>()
  if (semantic) for (const s of semantic.seats) lit.set(s.seat, { level: 'sure', why: s.why })
  else for (const s of instant.seats) lit.set(s.seat, { level: 'guess', why: `heard “${s.hits.slice(0, 3).join('”, “')}”` })
  const litProducts = new Set((semantic?.products ?? instant.products).map(p => p.id))

  return (
    <div className="grid md:grid-cols-[1fr_230px] gap-4">
      <div className="space-y-2">
        <div className={cn('relative rounded-xl', listening && 'ring-2 ring-mk-bad/60')}>
          <textarea className={cn(tone.input, 'min-h-[120px] resize-y pr-12')} value={interim ? `${text}${text ? ' ' : ''}${interim}` : text}
            onChange={e => setText(e.target.value)} disabled={busy}
            placeholder="Tell the team what you want — type or press the mic and just talk, in English or Hinglish. Watch who lights up on the right."
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
          <button onClick={toggleMic} aria-label={listening ? 'Stop dictation' : 'Dictate'}
            title={listening ? 'Stop' : 'Dictate (Chrome transcribes your voice through Google)'}
            className={cn('absolute right-2 top-2 p-2 rounded-lg', listening ? 'bg-mk-bad text-white animate-pulse' : 'text-mk-muted hover:text-mk-text hover:bg-mk-line')}>
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={tone.primaryBtn} onClick={send} disabled={busy || !live}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to the team
          </button>
          <select value={lang} onChange={e => setLang(e.target.value)} disabled={listening}
            className="bg-mk-bg border border-mk-line rounded-lg px-2 py-1.5 text-xs text-mk-muted" title="Dictation language">
            {DICTATION_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          {listening && <span className="text-xs text-mk-bad">Listening…</span>}
          {products.length > 0 && (
            <div className="flex flex-wrap gap-1.5 ml-auto">
              {products.map(p => (
                <span key={p.id} className={cn('text-[11px] px-2 py-0.5 rounded-full border transition-all',
                  litProducts.has(p.id) ? 'border-mk-accent text-mk-text bg-mk-accent/20' : 'border-mk-line text-mk-faint')}>{p.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5" aria-live="polite">
        <p className="text-[11px] uppercase tracking-wider text-mk-muted flex items-center gap-1.5">
          {reading ? <><Loader2 className="w-3 h-3 animate-spin" /> Reading what you mean…</>
            : semantic ? <><Sparkles className="w-3 h-3 text-mk-accent-soft" /> Who’ll pick this up</>
              : live ? 'First guess' : 'Your team'}
        </p>
        {TEAM.map(m => {
          const l = lit.get(m.seat)
          return (
            <div key={m.seat} title={l?.why}
              className={cn('rounded-lg border px-3 py-1.5 transition-all duration-300',
                l?.level === 'sure' ? 'border-mk-accent bg-mk-accent/20 shadow-[0_0_14px_rgba(108,99,255,0.45)]'
                  : l?.level === 'guess' ? 'border-mk-accent/50 bg-mk-accent/10'
                    : 'border-mk-line opacity-40')}>
              <p className={cn('text-sm', l ? 'text-mk-text' : 'text-mk-muted')}>{m.name} <span className="text-[10px] text-mk-muted">· {m.role}</span></p>
              {l && <p className="text-[11px] text-mk-accent-soft leading-snug">{l.why}</p>}
            </div>
          )
        })}
        {semanticError && live && <p className="text-[10px] text-mk-muted">Instant guess only — {semanticError}</p>}
      </div>
    </div>
  )
}
