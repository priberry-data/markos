'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Mail } from 'lucide-react'
import { Cite, Pill, tone } from '@/components/engine/ui'

export interface PipelineRow {
  id: string
  kind: string
  name: string
  website: string | null
  why_fit: string | null
  source: string | null
  contact: string | null
  contact_confirmed: boolean
  stage: string
  next_step: string | null
  pitch_subject: string | null
  pitch_body: string | null
  updated_at: string | null
}

const STAGES = ['identified', 'contacted', 'replied', 'meeting', 'won', 'lost', 'dropped']

export function PipelineCard({ r, canSend }: { r: PipelineRow; canSend: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  // What's saved. A field the founder hasn't changed takes up a newly saved value (from another
  // window, say); a field they're editing keeps their words, including words typed after their own
  // Save or Confirm and before the page caught up.
  const saved = { contact: r.contact ?? '', subject: r.pitch_subject ?? '', body: r.pitch_body ?? '' }
  const [seen, setSeen] = useState(saved)
  const [contact, setContact] = useState(saved.contact)
  const [subject, setSubject] = useState(saved.subject)
  const [body, setBody] = useState(saved.body)
  const [open, setOpen] = useState(false)
  if (saved.contact !== seen.contact || saved.subject !== seen.subject || saved.body !== seen.body) {
    if (saved.contact !== seen.contact && contact === seen.contact) setContact(saved.contact)
    if (saved.subject !== seen.subject && subject === seen.subject) setSubject(saved.subject)
    if (saved.body !== seen.body && body === seen.body) setBody(saved.body)
    setSeen(saved)
  }

  // Refused because the page is out of date (Send checks the version shown): show what's there now.
  const failed = (err: unknown) => {
    toast.error((err as Error).message)
    if ((err as { status?: number }).status === 409) router.refresh()
  }
  async function act(key: string, url: string, method: string, payload: unknown, ok: string) {
    setBusy(key)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(json.error ?? 'Something went wrong'), { status: res.status })
      toast.success(ok)
      router.refresh()
    } catch (err) {
      failed(err)
    } finally {
      setBusy(null)
    }
  }
  const patch = (key: string, payload: Record<string, unknown>, ok: string) => act(key, `/api/pipeline/${r.id}`, 'PATCH', payload, ok)
  // Send goes with the saved pitch only, so the card must show it: save edits first.
  const unsaved = contact !== saved.contact || subject !== saved.subject || body !== saved.body
  async function send(force = false): Promise<void> {
    setBusy('send')
    try {
      const res = await fetch(`/api/pipeline/${r.id}/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force, version: r.updated_at, to: contact, subject, body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.canForce && confirm(`${json.error} Send this pitch again?`)) return await send(true)
        throw Object.assign(new Error(json.error ?? 'Something went wrong'), { status: res.status })
      }
      toast.success(`Sent to ${r.name}`)
      router.refresh()
    } catch (err) {
      failed(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={`${tone.inset} px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-mk-text">{r.name}</p>
        <Pill>{r.kind.replace('_', ' ')}</Pill>
        {r.website && <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-xs text-mk-accent hover:underline">site</a>}
        <Cite url={r.source} />
        <select value={r.stage} disabled={busy !== null} onChange={e => patch('stage', { stage: e.target.value }, `Moved to ${e.target.value}`)}
          className="ml-auto bg-mk-card border border-mk-line rounded-lg px-2 py-1 text-xs text-mk-text">
          {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {r.why_fit && <p className="text-xs text-mk-body mt-1.5">{r.why_fit}</p>}
      <button className="text-xs text-mk-muted hover:text-mk-text mt-2" onClick={() => setOpen(!open)}>{open ? 'Hide pitch' : 'Pitch & contact'}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2 items-center">
            <input className={tone.input} value={contact} onChange={e => setContact(e.target.value)} placeholder="Email address (only one you've checked)" />
            {r.contact_confirmed && contact === r.contact
              ? <span className="text-xs text-mk-ok whitespace-nowrap inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> confirmed</span>
              : <button className={tone.ghostBtn} disabled={busy !== null || !contact.includes('@')}
                  onClick={() => patch('contact', { contact, contact_confirmed: true }, 'Address confirmed')}>Confirm address</button>}
          </div>
          <input className={tone.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
          <textarea className={`${tone.input} min-h-[120px]`} value={body} onChange={e => setBody(e.target.value)} placeholder="Pitch" />
          <div className="flex gap-2">
            <button className={tone.ghostBtn} disabled={busy !== null} onClick={() => patch('pitch', { pitch_subject: subject, pitch_body: body }, 'Pitch saved')}>Save pitch</button>
            <button className={tone.primaryBtn} disabled={busy !== null || !canSend || !r.contact_confirmed || unsaved}
              title={!canSend ? 'Set RESEND_API_KEY and RESEND_FROM_EMAIL to send' : !r.contact_confirmed ? 'Confirm the address first' : unsaved ? 'Save your edits first' : undefined}
              onClick={() => send()}>
              {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send pitch
            </button>
            <button className={tone.ghostBtn} disabled={busy !== null} onClick={() => patch('stage', { stage: 'contacted' }, 'Marked as contacted')}>I sent it myself</button>
          </div>
        </div>
      )}
    </div>
  )
}
