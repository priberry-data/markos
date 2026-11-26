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
}

const STAGES = ['identified', 'contacted', 'replied', 'meeting', 'won', 'lost', 'dropped']

export function PipelineCard({ r, canSend }: { r: PipelineRow; canSend: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [contact, setContact] = useState(r.contact ?? '')
  const [subject, setSubject] = useState(r.pitch_subject ?? '')
  const [body, setBody] = useState(r.pitch_body ?? '')
  const [open, setOpen] = useState(false)

  async function act(key: string, url: string, method: string, payload: unknown, ok: string) {
    setBusy(key)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      toast.success(ok)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const patch = (key: string, payload: Record<string, unknown>, ok: string) => act(key, `/api/pipeline/${r.id}`, 'PATCH', payload, ok)

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
            <button className={tone.primaryBtn} disabled={busy !== null || !canSend || !r.contact_confirmed || contact !== r.contact}
              title={!canSend ? 'Set RESEND_API_KEY and RESEND_FROM_EMAIL to send' : !r.contact_confirmed ? 'Confirm the address first' : undefined}
              onClick={() => act('send', `/api/pipeline/${r.id}/send`, 'POST', {}, `Sent to ${r.name}`)}>
              {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send pitch
            </button>
            <button className={tone.ghostBtn} disabled={busy !== null} onClick={() => patch('stage', { stage: 'contacted' }, 'Marked as contacted')}>I sent it myself</button>
          </div>
        </div>
      )}
    </div>
  )
}
