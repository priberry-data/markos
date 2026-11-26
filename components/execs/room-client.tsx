'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight, CalendarDays, CheckCircle2, HelpCircle, Loader2, Mic, MicOff, Send, XCircle, Zap, FileText, Bug, Route } from 'lucide-react'
import { tone } from '@/components/engine/ui'
import { cn } from '@/lib/utils'
import { DICTATION_LANGS, useDictation } from './use-dictation'
import { PEOPLE } from '@/lib/engine/execs/people'

export interface RoomMessage {
  id: string; speaker: string; to_seats: string[]; kind: string; content: string
  created_at: string; meeting_id: string | null; task_id: string | null
}

// What to type to @mention each seat.
const MENTION_FOR: Record<string, string> = { cmo: 'cmo', cfo: 'cfo', cpo: 'cpo', cto: 'cto', sales: 'sales', coo: 'coo', qa: 'qa', cx: 'customer', ea: 'myra', data: 'data', platform: 'platform' }

const who = (s: string) => PEOPLE[s] ?? { name: s, color: '#8888AA' }

const KIND: Record<string, { icon: typeof Send; label: string }> = {
  handoff: { icon: ArrowRight, label: 'handed over' },
  question: { icon: HelpCircle, label: 'asked' },
  answer: { icon: HelpCircle, label: 'answered' },
  move: { icon: Zap, label: 'is taking on' },
  done: { icon: CheckCircle2, label: 'finished' },
  failed: { icon: XCircle, label: 'couldn’t finish' },
  report: { icon: FileText, label: 'reported' },
  meeting: { icon: CalendarDays, label: 'booked a meeting' },
  issue: { icon: Bug, label: 'filed a bug' },
  routing: { icon: Route, label: 'routed' },
}

const CONVERSATION = new Set(['chat', 'question', 'answer', 'routing'])

export function Room({ initial, to }: { initial: RoomMessage[]; to?: string | null }) {
  const [messages, setMessages] = useState(initial)
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState(to && MENTION_FOR[to] ? `@${MENTION_FOR[to]} ` : '')
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState<'all' | 'talk' | 'work'>('all')
  const bottom = useRef<HTMLDivElement>(null)
  const dictation = useDictation(t => setText(prev => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${t}`))

  // Keep up with the room: poll quickly while the team is replying, slowly otherwise.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const last = messages[messages.length - 1]?.created_at
      try {
        const res = await fetch(`/api/room${last ? `?since=${encodeURIComponent(last)}` : ''}`)
        const json = await res.json() as { messages: RoomMessage[]; replying: boolean }
        if (!alive) return
        if (json.messages.length) setMessages(m => [...m, ...json.messages.filter(x => !m.some(y => y.id === x.id))])
        setReplying(json.replying)
      } catch {}
    }
    const t = setInterval(tick, replying || sending ? 2000 : 6000)
    return () => { alive = false; clearInterval(t) }
  }, [messages, replying, sending])

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length])

  async function send() {
    const body = `${text}${dictation.interim ? ` ${dictation.interim}` : ''}`.trim()
    if (!body) return
    dictation.stop()
    setSending(true)
    try {
      const res = await fetch('/api/room', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send')
      setText('')
      setReplying(true)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const shown = messages.filter(m => filter === 'all' || (filter === 'talk' ? CONVERSATION.has(m.kind) || m.speaker === 'founder' : !CONVERSATION.has(m.kind)))

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] min-h-[480px]">
      <div className="flex gap-1 mb-3">
        {(['all', 'talk', 'work'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1 rounded-full text-xs', filter === f ? 'bg-mk-accent text-white' : 'text-mk-muted hover:text-mk-text bg-mk-card border border-mk-line')}>
            {f === 'all' ? 'Everything' : f === 'talk' ? 'Conversation' : 'Work updates'}
          </button>
        ))}
      </div>

      <div className={`${tone.card} flex-1 overflow-y-auto p-4 space-y-3`}>
        {shown.length === 0 && <p className={`${tone.muted} text-center mt-10`}>The room is quiet. Say something — or @mention someone, like “@cfo what’s our runway?”</p>}
        {shown.map(m => <Bubble key={m.id} m={m} />)}
        {replying && <p className="text-xs text-mk-muted flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> the team is replying…</p>}
        <div ref={bottom} />
      </div>

      <div className="mt-3 flex gap-2 items-end">
        <div className={cn('relative flex-1 rounded-xl', dictation.listening && 'ring-2 ring-mk-bad/60')}>
          <textarea autoFocus={Boolean(to)} className={cn(tone.input, 'min-h-[52px] max-h-40 resize-y pr-12')} disabled={sending}
            value={dictation.interim ? `${text}${text ? ' ' : ''}${dictation.interim}` : text} onChange={e => setText(e.target.value)}
            placeholder="Message the team… @cmo @cfo @data @cpo @cto @sales @coo @qa @platform @customer @myra — Enter to send, Shift+Enter for a new line"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
          <button onClick={dictation.toggle} aria-label={dictation.listening ? 'Stop dictation' : 'Dictate'}
            className={cn('absolute right-2 top-2 p-2 rounded-lg', dictation.listening ? 'bg-mk-bad text-white animate-pulse' : 'text-mk-muted hover:text-mk-text hover:bg-mk-line')}>
            {dictation.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
        <select value={dictation.lang} onChange={e => dictation.setLang(e.target.value)} disabled={dictation.listening}
          className="bg-mk-bg border border-mk-line rounded-lg px-2 py-2 text-xs text-mk-muted" title="Dictation language">
          {DICTATION_LANGS.map(l => <option key={l.code} value={l.code} title={l.label}>{l.short}</option>)}
        </select>
        <button className={tone.primaryBtn} onClick={send} disabled={sending || !(text || dictation.interim).trim()}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

function Bubble({ m }: { m: RoomMessage }) {
  const p = who(m.speaker)
  const mine = m.speaker === 'founder'
  const k = KIND[m.kind]
  const to = m.to_seats.map(s => who(s).name)
  const time = new Date(m.created_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

  if (k && m.kind !== 'question' && m.kind !== 'answer' && m.kind !== 'routing') {
    // Work updates: compact, one line, so the conversation stays readable.
    const Icon = k.icon
    return (
      <div className="flex items-start gap-2 text-xs text-mk-muted pl-1">
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: p.color }} />
        <p className="flex-1"><span style={{ color: p.color }}>{p.name}</span> {k.label}{to.length ? <> → <span className="text-mk-body">{to.join(', ')}</span></> : null}: <span className="text-mk-body whitespace-pre-wrap">{m.content}</span>
          {m.meeting_id && <Link href={`/meetings/${m.meeting_id}`} className="text-mk-accent hover:underline ml-1">open</Link>}</p>
        <span className="text-[10px] shrink-0">{time}</span>
      </div>
    )
  }
  return (
    <div className={cn('flex gap-2', mine && 'flex-row-reverse')}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 text-mk-bg" style={{ background: p.color }}>
        {p.name.slice(0, 2).toUpperCase()}
      </div>
      <div className={cn('max-w-[78%] rounded-2xl px-3.5 py-2', mine ? 'bg-mk-accent/25' : 'bg-mk-bg border border-mk-line')}>
        <p className="text-[11px] mb-0.5" style={{ color: p.color }}>
          {p.name}{to.length ? <span className="text-mk-muted"> → {to.join(', ')}</span> : null}
          {k ? <span className="text-mk-muted"> · {k.label}</span> : null}
          <span className="text-mk-faint"> · {time}</span>
        </p>
        <p className="text-sm text-mk-body whitespace-pre-wrap leading-relaxed">{m.content}</p>
      </div>
    </div>
  )
}
