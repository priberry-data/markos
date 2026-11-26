'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MessageCircle, Send, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  action: { type: string; summary: string } | null
  action_status: string | null
}

const SUGGESTIONS = [
  'What should I focus on this week?',
  'Rewrite tomorrow’s LinkedIn post to be shorter',
  'Which communities should I post in first?',
  'Never use emojis in anything',
]

/** LYRA — ask anything about your marketing, or ask the team to do something. */
export function LyraPanel({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    fetch(`/api/assistant?productId=${productId}`).then(r => r.json()).then(d => setMessages(d.messages ?? []))
  }, [open, productId])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  async function sendMessage(message: string) {
    if (!message.trim() || busy) return
    setError(null)
    setBusy('ask')
    setMessages(m => [...m, { id: `tmp-${Date.now()}`, role: 'user', content: message, action: null, action_status: null }])
    setText('')
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, message }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setMessages(m => [...m, body.message])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, decision: 'confirm' | 'dismiss') {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/assistant/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      const refreshed = await (await fetch(`/api/assistant?productId=${productId}`)).json()
      setMessages(refreshed.messages ?? [])
      if (decision === 'confirm') router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl bg-mk-accent text-white shadow-lg shadow-mk-accent/30 hover:bg-mk-accent-strong">
        <MessageCircle className="w-4 h-4" /> Ask LYRA
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col bg-mk-bg border border-mk-line rounded-2xl shadow-2xl">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-mk-line">
        <div className="w-7 h-7 rounded-lg bg-mk-accent flex items-center justify-center"><Zap className="w-3.5 h-3.5 text-white" /></div>
        <div className="flex-1"><p className="text-sm font-semibold text-mk-text">LYRA</p><p className="text-[11px] text-mk-muted">Chief of staff · {productName}</p></div>
        <button onClick={() => setOpen(false)} className="text-mk-muted hover:text-mk-text"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-mk-muted">Ask about your marketing, or ask the team to do something. Anything that changes work or costs money waits for your OK.</p>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => sendMessage(s)} className="block w-full text-left text-sm text-mk-body bg-mk-card border border-mk-line rounded-xl px-3 py-2 hover:border-mk-accent">{s}</button>
            ))}
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap',
              m.role === 'user' ? 'bg-mk-accent text-white' : 'bg-mk-card border border-mk-line text-mk-body')}>
              {m.content}
              {m.action && (
                <div className="mt-2.5 pt-2.5 border-t border-mk-line">
                  {m.action_status === 'proposed' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button disabled={busy !== null} onClick={() => decide(m.id, 'confirm')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
                        {busy === m.id && <Loader2 className="w-3 h-3 animate-spin" />}{m.action.summary || 'Do it'}
                      </button>
                      <button disabled={busy !== null} onClick={() => decide(m.id, 'dismiss')} className="text-xs text-mk-muted">Not now</button>
                    </div>
                  ) : (
                    <p className="text-xs text-mk-muted">{m.action.summary} — {m.action_status === 'done' ? 'done' : m.action_status}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy === 'ask' && <div className="flex"><div className="bg-mk-card border border-mk-line rounded-2xl px-3.5 py-2.5"><Loader2 className="w-4 h-4 text-mk-accent animate-spin" /></div></div>}
        {error && <p className="text-xs text-mk-bad">{error}</p>}
        <div ref={end} />
      </div>

      <form onSubmit={e => { e.preventDefault(); sendMessage(text) }} className="p-3 border-t border-mk-line flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Ask LYRA…"
          className="flex-1 bg-mk-card border border-mk-line rounded-xl px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent" />
        <button disabled={!text.trim() || busy !== null} className="px-3 rounded-xl bg-mk-accent text-white disabled:opacity-50"><Send className="w-4 h-4" /></button>
      </form>
    </div>
  )
}
