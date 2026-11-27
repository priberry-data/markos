'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarPlus, Check, Loader2, Mail, Send, X } from 'lucide-react'
import { Pill, tone } from '@/components/engine/ui'
import { cn } from '@/lib/utils'
import { EXEC_LABELS } from './brief-client'
import { when } from '@/lib/utils/when'

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error ?? 'Something went wrong'), { body: json, status: res.status })
  return json
}

function useAct() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast.success(ok); router.refresh() } catch (err) {
      toast.error((err as Error).message)
      // Refused because the page is out of date (Send checks the version shown): show what's there now.
      if ((err as { status?: number }).status === 409) router.refresh()
    } finally { setBusy(null) }
  }
  return { busy, act }
}


/** "Set up 20 minutes with the CFO about team pricing" — Myra books it. */
export function BookMeeting() {
  const [text, setText] = useState('')
  const { busy, act } = useAct()
  return (
    <div className="flex gap-2">
      <input className={tone.input} value={text} onChange={e => setText(e.target.value)} disabled={busy !== null}
        placeholder="Ask Myra: “set up time with the CFO about team pricing this week”"
        onKeyDown={e => { if (e.key === 'Enter' && text.trim()) act('book', async () => { const r = await api('/api/meetings', 'POST', { text }); setText(''); toast.success(`Booked for ${when(r.scheduledAt)}`) }) }} />
      <button className={tone.primaryBtn} disabled={busy !== null || !text.trim()}
        onClick={() => act('book', async () => { const r = await api('/api/meetings', 'POST', { text }); setText(''); toast.success(`Booked for ${when(r.scheduledAt)}`) })}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} Book
      </button>
    </div>
  )
}

export function RetryCalendar() {
  const { busy, act } = useAct()
  return (
    <button className="text-xs text-mk-accent hover:underline disabled:opacity-50" disabled={busy !== null}
      onClick={() => act('sync', () => api('/api/meetings', 'POST', { action: 'sync' }), 'Tried again')}>
      {busy ? 'Trying…' : 'Try again'}
    </button>
  )
}

export function MeetingActions({ id, status }: { id: string; status: string }) {
  const { busy, act } = useAct()
  if (status === 'done' || status === 'cancelled' || status === 'missed') return null
  return (
    <div className="flex flex-wrap gap-2">
      <button className={tone.ghostBtn} disabled={busy !== null}
        onClick={() => act('re', async () => { const r = await api(`/api/meetings/${id}`, 'POST', { action: 'reschedule' }); toast.success(`Moved to ${when(r.scheduledAt)}`) })}>
        Reschedule
      </button>
      <button className={tone.ghostBtn} disabled={busy !== null}
        onClick={() => { if (confirm('Cancel this meeting?')) act('cancel', () => api(`/api/meetings/${id}`, 'POST', { action: 'cancel' }), 'Cancelled') }}>
        Cancel
      </button>
    </div>
  )
}

export interface Line { speaker: string; content: string }

export function MeetingRoom({ id, status, lines }: { id: string; status: string; lines: Line[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'say' | 'end' | null>(null)
  const open = status === 'scheduled' || status === 'in_progress'

  async function say() {
    if (!text.trim()) return
    setBusy('say')
    try { await api(`/api/meetings/${id}`, 'POST', { action: 'say', text }); setText(''); router.refresh() }
    catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }
  async function end() {
    setBusy('end')
    try { await api(`/api/meetings/${id}`, 'POST', { action: 'end' }); toast.success('Myra wrote the minutes; action items are now tasks'); router.refresh() }
    catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {lines.length === 0 && <p className={tone.muted}>{open ? 'Start the meeting: ask a question, or decide an agenda item.' : 'Nothing was said in this meeting.'}</p>}
        {lines.map((l, i) => (
          <div key={i} className={cn('rounded-xl px-4 py-2.5 max-w-[85%]', l.speaker === 'founder' ? 'ml-auto bg-mk-accent/20' : tone.inset)}>
            <p className="text-[11px] text-mk-accent-soft mb-0.5">{l.speaker === 'founder' ? 'You' : EXEC_LABELS[l.speaker] ?? l.speaker}</p>
            <p className="text-sm text-mk-body whitespace-pre-wrap">{l.content}</p>
          </div>
        ))}
        {busy === 'say' && <p className={tone.muted}><Loader2 className="inline w-3 h-3 animate-spin mr-1" />thinking…</p>}
      </div>
      {open && (
        <div className="space-y-2">
          <div className="flex gap-2 items-end">
            <textarea className={cn(tone.input, 'min-h-[60px]')} value={text} onChange={e => setText(e.target.value)} disabled={busy !== null}
              placeholder="Ask, push back, or decide: “Go with option B, ship it Friday.”"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) say() }} />
            <button className={tone.primaryBtn} disabled={busy !== null || !text.trim()} onClick={say}><Send className="w-4 h-4" /></button>
          </div>
          <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-ok text-mk-bg hover:opacity-90 disabled:opacity-50"
            disabled={busy !== null} onClick={end}>
            {busy === 'end' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} End meeting — Myra writes the minutes
          </button>
        </div>
      )}
    </div>
  )
}

export function TodoRow({ id, task, due, why }: { id: string; task: string; due: string | null; why: string | null }) {
  const { busy, act } = useAct()
  const overdue = due && due < new Date().toISOString().slice(0, 10)
  return (
    <div className={`${tone.inset} px-3 py-2 flex items-start gap-3`}>
      <button aria-label="Done" disabled={busy !== null} onClick={() => act('done', () => api(`/api/tasks/${id}`, 'POST', { action: 'done' }), 'Done')}
        className="mt-0.5 w-4 h-4 rounded border border-mk-faint hover:border-mk-ok shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-mk-body">{task}</p>
        <p className="text-[11px] text-mk-muted">{due && <span className={overdue ? 'text-mk-bad' : ''}>due {due}{overdue ? ' — overdue' : ''}</span>}{why ? ` · ${why}` : ''}</p>
      </div>
    </div>
  )
}

export interface CustomerView {
  id: string; name: string; email: string | null; company: string | null; segment: string | null
  draft_subject: string | null; draft_body: string | null; draft_purpose: string | null; last_contacted_at: string | null
  updated_at: string | null
}

export function CustomerCard({ c, canSend }: { c: CustomerView; canSend: boolean }) {
  const { busy, act } = useAct()
  // What's saved. A field the founder hasn't changed takes up a newly saved value (a new follow-up
  // from the team, another tab's save); a field they're editing keeps their words, including words
  // typed after their own Save and before the page caught up. With no draft left (sent or dropped)
  // there's nothing to edit, so its fields show what's saved and nothing typed into it comes back.
  const saved = { email: c.email ?? '', subject: c.draft_subject ?? '', body: c.draft_body ?? '' }
  const [seen, setSeen] = useState(saved)
  const [subject, setSubject] = useState(saved.subject)
  const [body, setBody] = useState(saved.body)
  const [email, setEmail] = useState(saved.email)
  if (saved.email !== seen.email || saved.subject !== seen.subject || saved.body !== seen.body) {
    if (saved.email !== seen.email && email === seen.email) setEmail(saved.email)
    if (!saved.body) {
      setSubject(saved.subject)
      setBody(saved.body)
    } else {
      if (saved.subject !== seen.subject && subject === seen.subject) setSubject(saved.subject)
      if (saved.body !== seen.body && body === seen.body) setBody(saved.body)
    }
    setSeen(saved)
  }
  // Send goes with the saved words only, so the card must show them: save edits first.
  const unsaved = email !== saved.email || subject !== saved.subject || body !== saved.body
  const send = () => act('send', async () => {
    const shown = { version: c.updated_at, to: email, subject, body }
    try { await api(`/api/customers/${c.id}/send`, 'POST', shown) }
    catch (err) {
      // Written to within two weeks: send only if the founder says so, in this same action.
      const b = (err as { body?: { canForce?: boolean } }).body
      if (!b?.canForce || !confirm(`${(err as Error).message} Send anyway?`)) throw err
      await api(`/api/customers/${c.id}/send`, 'POST', { ...shown, force: true })
    }
  }, `Sent to ${c.name}`)
  return (
    <div className={`${tone.inset} px-4 py-3 space-y-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-mk-text">{c.name}</p>
        {c.company && <span className="text-xs text-mk-muted">{c.company}</span>}
        {c.segment && <Pill>{c.segment}</Pill>}
        <span className="text-[11px] text-mk-muted ml-auto">{c.last_contacted_at ? `last contacted ${c.last_contacted_at.slice(0, 10)}` : 'never contacted'}</span>
        <button className="text-mk-muted hover:text-mk-bad" aria-label="Remove" onClick={() => { if (confirm(`Remove ${c.name}?`)) act('rm', () => api(`/api/customers/${c.id}`, 'DELETE')) }}><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="flex gap-2">
        <input className={tone.input} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
        {email !== (c.email ?? '') && <button className={tone.ghostBtn} onClick={() => act('email', () => api(`/api/customers/${c.id}`, 'PATCH', { email }), 'Saved')}>Save</button>}
      </div>
      {c.draft_body && (
        <div className="space-y-2 border-t border-mk-line pt-2">
          <p className={tone.label}>Draft from the Customer team{c.draft_purpose ? ` · ${c.draft_purpose}` : ''}</p>
          <input className={tone.input} value={subject} onChange={e => setSubject(e.target.value)} />
          <textarea className={cn(tone.input, 'min-h-[110px]')} value={body} onChange={e => setBody(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {(subject !== (c.draft_subject ?? '') || body !== (c.draft_body ?? '')) &&
              <button className={tone.ghostBtn} onClick={() => act('save', () => api(`/api/customers/${c.id}`, 'PATCH', { draft_subject: subject, draft_body: body }), 'Draft saved')}>Save edits</button>}
            <button className={tone.primaryBtn} disabled={busy !== null || !canSend || !c.email || unsaved}
              title={!canSend ? 'Set RESEND_API_KEY and RESEND_FROM_EMAIL to send' : !c.email ? 'Add an email first' : unsaved ? 'Save your edits first' : undefined}
              onClick={() => send()}>
              {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Approve & send
            </button>
            <button className={tone.ghostBtn} onClick={() => act('drop', () => api(`/api/customers/${c.id}`, 'PATCH', { draft_subject: '', draft_body: '', draft_purpose: '' }), 'Draft dropped')}>Drop draft</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AddCustomers({ productId }: { productId: string }) {
  const [lines, setLines] = useState('')
  const { busy, act } = useAct()
  return (
    <div className="space-y-2">
      <textarea className={cn(tone.input, 'min-h-[70px] font-mono text-xs')} value={lines} onChange={e => setLines(e.target.value)}
        placeholder={'One per line: Name, email, company, segment\nAsha Rao, asha@example.com, Acme, design partner'} />
      <button className={tone.primaryBtn} disabled={busy !== null || !lines.trim()}
        onClick={() => act('add', async () => { const r = await api('/api/customers', 'POST', { productId, lines }); setLines(''); toast.success(`Added ${r.added}`) })}>Add customers</button>
    </div>
  )
}

export function ConversationBox({ productId, customers }: { productId: string; customers: Array<{ id: string; name: string }> }) {
  const [content, setContent] = useState('')
  const [customerId, setCustomerId] = useState('')
  const { busy, act } = useAct()
  return (
    <div className="space-y-2">
      <textarea className={cn(tone.input, 'min-h-[100px]')} value={content} onChange={e => setContent(e.target.value)}
        placeholder="Paste a customer conversation, call notes or feedback. The Customer team pulls out pains, quotes and bugs, and sends each to whoever can act on it." />
      <div className="flex gap-2">
        <select className="bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text" value={customerId} onChange={e => setCustomerId(e.target.value)}>
          <option value="">Not linked to a customer</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={tone.primaryBtn} disabled={busy !== null || content.trim().length < 20}
          onClick={() => act('note', async () => { await api('/api/customers/notes', 'POST', { productId, customerId: customerId || null, content }); setContent('') }, 'Synthesised and routed to the team')}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Make sense of it
        </button>
      </div>
    </div>
  )
}

export function IssueStatus({ id, status }: { id: string; status: string }) {
  const { busy, act } = useAct()
  return (
    <select value={status} disabled={busy !== null} onChange={e => act('s', () => api(`/api/issues/${id}`, 'PATCH', { status: e.target.value }), 'Updated')}
      className="bg-mk-card border border-mk-line rounded-lg px-2 py-1 text-xs text-mk-text">
      <option value="open">open</option><option value="fixed">fixed</option><option value="wont_fix">won’t fix</option>
    </select>
  )
}

export function WorkingDay({ p }: { p: { work_start: string; work_end: string; meeting_windows: string; max_meetings_per_day: number; night_budget_usd: number } }) {
  const [v, setV] = useState({ ...p })
  const { busy, act } = useAct()
  const field = (k: keyof typeof v, label: string, w = 'w-28') => (
    <label className={`block ${w}`}><span className="block text-xs text-mk-muted mb-1.5">{label}</span>
      <input className={tone.input} value={String(v[k])} onChange={e => setV({ ...v, [k]: e.target.value })} /></label>
  )
  return (
    <div className="flex flex-wrap items-end gap-3">
      {field('work_start', 'Day starts')}{field('work_end', 'Day ends')}
      {field('meeting_windows', 'Meeting windows', 'w-64')}{field('max_meetings_per_day', 'Max meetings/day')}
      {field('night_budget_usd', 'Night cap (USD)')}
      <button className={tone.primaryBtn} disabled={busy !== null}
        onClick={() => act('save', () => api('/api/profile', 'PATCH', { ...v, max_meetings_per_day: Number(v.max_meetings_per_day), night_budget_usd: Number(v.night_budget_usd) }), 'Saved — Myra will plan around it')}>Save</button>
    </div>
  )
}
