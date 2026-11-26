'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Loader2, Moon, RotateCcw, Send, Square } from 'lucide-react'
import { tone } from '@/components/engine/ui'
import { cn } from '@/lib/utils'

export { EXEC_LABELS } from '@/lib/engine/execs/people'
import { EXEC_LABELS } from '@/lib/engine/execs/people'

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
  return json
}

/** Keeps the page current while the team is working. */
export function AutoRefresh({ active, every = 5000 }: { active: boolean; every?: number }) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => router.refresh(), every)
    return () => clearInterval(t)
  }, [active, every, router])
  return null
}

/** One box for everything: the Chief of Staff routes it to whoever owns it. */
export function InstructionBox({ exec, placeholder, compact }: { exec?: string; placeholder?: string; compact?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await call('/api/directives', 'POST', { text, exec })
      setText('')
      toast.success(exec ? `Sent to ${EXEC_LABELS[exec]}` : 'Your Chief of Staff is routing it')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn('flex gap-2', compact ? 'items-center' : 'items-end')}>
      {compact ? (
        <input className={tone.input} value={text} onChange={e => setText(e.target.value)} disabled={busy}
          placeholder={placeholder ?? 'Message…'} onKeyDown={e => { if (e.key === 'Enter') send() }} />
      ) : (
        <textarea className={cn(tone.input, 'min-h-[84px] resize-y')} value={text} onChange={e => setText(e.target.value)} disabled={busy}
          placeholder={placeholder ?? 'Tell the team what you want — in any words, any language. The Chief of Staff sends each part to the right exec.'}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} />
      )}
      <button className={tone.primaryBtn} onClick={send} disabled={busy || !text.trim()}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        {!compact && 'Send'}
      </button>
    </div>
  )
}

export function NightControls({ running }: { running: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function go(method: 'POST' | 'DELETE') {
    setBusy(true)
    try {
      await call('/api/night', method)
      toast.success(method === 'POST' ? 'The night shift has started' : 'Stopping the night shift')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return running ? (
    <button className={tone.ghostBtn} disabled={busy} onClick={() => go('DELETE')}>
      <Square className="w-3.5 h-3.5" /> Stop the shift
    </button>
  ) : (
    <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-text border border-mk-line hover:border-mk-accent disabled:opacity-60"
      disabled={busy} onClick={() => go('POST')}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Moon className="w-3.5 h-3.5" />} Run the night shift now
    </button>
  )
}

export interface TaskView {
  id: string
  exec: string
  product: string | null
  task: string
  status: string
  origin: string
  result_summary: string | null
  deliverable: string | null
  error_message: string | null
}

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-mk-muted', running: 'text-mk-accent-soft', done: 'text-mk-ok', failed: 'text-mk-bad', cancelled: 'text-mk-muted',
}

export function TaskRow({ t }: { t: TaskView }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    try {
      await call(`/api/tasks/${t.id}`, 'POST', body)
      toast.success(ok)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cn(tone.inset, 'px-3 py-2.5')}>
      <div className="flex items-start gap-2">
        <button className="mt-0.5 text-mk-muted" onClick={() => setOpen(!open)} aria-label="Show result">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-mk-body">{t.task}</p>
          <p className="text-[11px] text-mk-muted mt-0.5 flex flex-wrap items-center gap-x-2">
            <select value={t.exec} disabled={busy || t.status === 'running'}
              onChange={e => act({ action: 'reroute', exec: e.target.value }, `Moved to ${EXEC_LABELS[e.target.value]}`)}
              className="bg-transparent text-mk-accent-soft font-medium focus:outline-none cursor-pointer" title="Send this to a different exec">
              {Object.entries(EXEC_LABELS).map(([k, v]) => <option key={k} value={k} className="bg-mk-card">→ {v}</option>)}
            </select>
            <span>{t.product ?? 'portfolio'}</span>
            {t.origin !== 'founder' && <span>handed over by {EXEC_LABELS[t.origin] ?? t.origin}</span>}
            <span className={STATUS_COLOR[t.status] ?? ''}>
              {t.status === 'running' && <Loader2 className="inline w-3 h-3 animate-spin mr-1" />}{t.status}
            </span>
            {(t.status === 'failed' || t.status === 'cancelled') && (
              <button className="inline-flex items-center gap-1 hover:text-mk-text" disabled={busy} onClick={() => act({ action: 'retry' }, 'Running it again')}>
                <RotateCcw className="w-3 h-3" /> retry
              </button>
            )}
          </p>
          {t.result_summary && <p className="text-xs text-mk-body mt-1.5">{t.result_summary}</p>}
          {t.error_message && t.status !== 'done' && <p className="text-xs text-mk-bad mt-1.5">{t.error_message}</p>}
          {open && t.deliverable && (
            <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-mk-body leading-relaxed border-t border-mk-line pt-2">{t.deliverable}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

export function Collapsible({ title, children, defaultOpen = false, right }: {
  title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-2 text-left flex-1 min-w-0" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="w-4 h-4 text-mk-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-mk-muted shrink-0" />}
          <span className="min-w-0 flex-1">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
