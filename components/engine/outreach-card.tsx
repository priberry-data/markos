'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ExternalLink, Loader2, Mail, Pencil, ShieldCheck, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

export interface OutreachTarget {
  id: string
  type: string
  name: string
  platform: string | null
  url: string | null
  audience_size: string | null
  why_good_fit: string | null
  approach: string | null
  handle_or_email: string | null
  contact_confirmed: boolean
  draft_subject: string | null
  outreach_draft: string | null
  source: string | null
  verified: boolean
  status: string
  sent_at: string | null
}

const STAGES = [
  { key: 'identified', label: 'To review' },
  { key: 'approved', label: 'Ready to contact' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'replied', label: 'Replied' },
  { key: 'in_talks', label: 'In talks' },
  { key: 'closed', label: 'Won' },
  { key: 'not_a_fit', label: 'Not a fit' },
]

const input = 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'

export function OutreachCard({ target, canEmail }: { target: OutreachTarget; canEmail: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'edit' | 'refine' | 'reject'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState({ email: target.handle_or_email ?? '', subject: target.draft_subject ?? '', body: target.outreach_draft ?? '' })

  async function req(url: string, method: string, body: Record<string, unknown> | null, success: string, key: string) {
    setBusy(key)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error ?? 'Something went wrong')
      toast.success(success)
      setMode(null)
      setText('')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const action = (body: Record<string, unknown>, success: string, key: string) => req(`/api/items/outreach/${target.id}`, 'POST', body, success, key)

  const isEmail = (target.handle_or_email ?? '').includes('@')

  return (
    <div className="bg-mk-card border border-mk-line rounded-2xl p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-mk-line text-mk-body">{target.type}</span>
            {target.url
              ? <a href={target.url} target="_blank" rel="noopener noreferrer" className="font-medium text-mk-text hover:underline inline-flex items-center gap-1">{target.name} <ExternalLink className="w-3 h-3 text-mk-muted" /></a>
              : <span className="font-medium text-mk-text">{target.name}</span>}
            {target.platform && <span className="text-xs text-mk-muted">{target.platform}</span>}
            {target.audience_size && <span className="text-xs text-mk-muted">· {target.audience_size}</span>}
          </div>
          <p className="text-xs mt-1">
            {target.verified && target.source
              ? <a href={target.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mk-ok hover:underline"><ShieldCheck className="w-3 h-3" /> found on {(() => { try { return new URL(target.source).host.replace(/^www\./, '') } catch { return 'source' } })()}</a>
              : <span className="text-mk-warn">Unverified — no retrieved page backs this. Check it exists before reaching out.</span>}
          </p>
        </div>
        <select value={target.status} disabled={busy !== null}
          onChange={e => action({ action: 'status', status: e.target.value }, 'Updated', 'status')}
          className="bg-mk-bg border border-mk-line rounded-lg text-xs text-mk-text px-2 py-1.5">
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {target.why_good_fit && <p className="text-sm text-mk-body mt-3">{target.why_good_fit}</p>}
      {target.approach && <p className="text-xs text-mk-muted mt-1">How: {target.approach}</p>}

      {mode === 'edit' ? (
        <div className="space-y-2 mt-3">
          <input className={input} value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email address (you confirm it by saving)" />
          <input className={input} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject" />
          <textarea className={cn(input, 'min-h-[140px]')} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setMode(null)} className="px-3 py-1.5 text-xs text-mk-muted">Cancel</button>
            <button disabled={busy !== null} onClick={() => req(`/api/items/outreach/${target.id}`, 'PATCH', {
              handle_or_email: draft.email || null, draft_subject: draft.subject || null, outreach_draft: draft.body,
            }, 'Saved', 'save')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-accent text-white">
              {busy === 'save' && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 bg-mk-bg border border-mk-line rounded-xl p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-mk-muted mb-2">
            <Mail className="w-3.5 h-3.5" />
            {target.handle_or_email ? (
              <>
                <span className="text-mk-body">{target.handle_or_email}</span>
                {isEmail && (target.contact_confirmed
                  ? <span className="text-mk-ok">confirmed</span>
                  : <button onClick={() => action({ action: 'confirm_contact' }, 'Address confirmed', 'confirm')} className="text-mk-warn hover:underline">
                      found publicly — confirm before sending
                    </button>)}
              </>
            ) : <span>No public contact found — add one if you have it.</span>}
          </div>
          {target.draft_subject && <p className="text-sm text-mk-text mb-1">Subject: {target.draft_subject}</p>}
          <p className="text-sm text-mk-body whitespace-pre-wrap leading-relaxed">{target.outreach_draft}</p>
        </div>
      )}

      {mode === 'refine' && (
        <div className="mt-3 flex gap-2">
          <input autoFocus className={input} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. shorter, mention we're free for students"
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) action({ action: 'refine', instruction: text }, 'Rewritten', 'refine') }} />
          <button disabled={busy !== null || !text.trim()} onClick={() => action({ action: 'refine', instruction: text }, 'Rewritten', 'refine')}
            className="inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
            {busy === 'refine' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Rewrite
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="mt-3 flex gap-2">
          <input autoFocus className={input} value={text} onChange={e => setText(e.target.value)} placeholder="Why not? (optional — the team will learn from it)" />
          <button disabled={busy !== null} onClick={() => action({ action: 'reject', reason: text }, 'Removed', 'reject')}
            className="px-3 rounded-lg text-xs font-medium bg-mk-bad/20 text-mk-bad">Remove</button>
        </div>
      )}

      {mode !== 'edit' && (
        <div className="flex flex-wrap items-center gap-1 mt-3 pt-3 border-t border-mk-line">
          {target.status === 'identified' && (
            <button disabled={busy !== null} onClick={() => action({ action: 'status', status: 'approved' }, 'Approved', 'approve')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
          )}
          {canEmail && isEmail && target.contact_confirmed && !target.sent_at && (
            <button disabled={busy !== null} onClick={() => req(`/api/outreach/${target.id}/send`, 'POST', null, `Sent to ${target.handle_or_email}`, 'send')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-ok/15 text-mk-ok disabled:opacity-50">
              {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Send email
            </button>
          )}
          {target.sent_at && <span className="text-xs text-mk-ok px-2">Sent {new Date(target.sent_at).toLocaleDateString()}</span>}
          <CopyButton text={[target.draft_subject ? `Subject: ${target.draft_subject}` : null, target.outreach_draft].filter(Boolean).join('\n\n')} />
          <button onClick={() => setMode('edit')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          <button onClick={() => setMode(mode === 'refine' ? null : 'refine')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line"><Sparkles className="w-3.5 h-3.5" /> Rewrite…</button>
          <button onClick={() => setMode(mode === 'reject' ? null : 'reject')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-bad hover:bg-mk-bad/10 ml-auto"><X className="w-3.5 h-3.5" /> Remove</button>
        </div>
      )}
    </div>
  )
}
