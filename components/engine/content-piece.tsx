'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, History, Loader2, Pencil, Send, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

export interface ContentPieceData {
  id: string
  platform: string
  content_type: string | null
  title: string | null
  hook: string | null
  body: string | null
  hashtags: string[] | null
  cta: string | null
  goal: string | null
  visual_idea: string | null
  scheduled_at: string | null
  status: string
  edited: boolean
  updated_at: string
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-mk-warn/15 text-mk-warn',
  approved: 'bg-mk-accent/20 text-mk-accent-soft',
  posted: 'bg-mk-ok/15 text-mk-ok',
  rejected: 'bg-mk-bad/15 text-mk-bad',
}

const input = 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const draftOf = (piece: ContentPieceData) => ({
  title: piece.title ?? '', body: piece.body ?? '', hashtags: (piece.hashtags ?? []).join(' '), when: toLocalInput(piece.scheduled_at),
})

export function ContentPiece({ piece }: { piece: ContentPieceData }) {
  const router = useRouter()
  const [mode, setMode] = useState<null | 'edit' | 'refine' | 'reject' | 'history'>(null)
  const [busy, setBusy] = useState(false)
  // Edit opens on the words the card shows now (a rewrite may have landed since it first rendered).
  const [draft, setDraft] = useState(() => draftOf(piece))
  const [text, setText] = useState('')
  const [versions, setVersions] = useState<Array<{ id: string; reason: string | null; created_at: string; content: { body?: string } }> | null>(null)

  const social = piece.platform === 'twitter' || piece.platform === 'linkedin'
  // New words the founder hasn't approved send an approved piece back to draft (lib/engine/items.ts).
  const backToDraft = social ? 'It’s back to draft: approve it again to post it.' : 'It’s back to draft: approve it again.'
  const rewritten = (out: { item?: { needsApproval?: boolean } }) => out.item?.needsApproval ? `Rewritten. ${backToDraft}` : 'Rewritten'

  async function call(method: 'POST' | 'PATCH', body: Record<string, unknown>, success: string | ((out: { item?: { needsApproval?: boolean } }) => string)) {
    setBusy(true)
    try {
      const res = await fetch(`/api/items/content/${piece.id}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const out = await res.json()
      if (!res.ok) throw Object.assign(new Error(out.error ?? 'Something went wrong'), { status: res.status })
      toast.success(typeof success === 'string' ? success : success(out))
      setMode(null)
      setText('')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
      // Refused because the card is out of date (Approve checks the version shown): show what's there now.
      if ((err as { status?: number }).status === 409) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function openHistory() {
    setMode(mode === 'history' ? null : 'history')
    if (versions) return
    const res = await fetch(`/api/items/content/${piece.id}/versions`)
    setVersions((await res.json()).versions ?? [])
  }

  async function restore(versionId: string) {
    const res = await fetch(`/api/items/versions/${versionId}/restore`, { method: 'POST' })
    const out = await res.json().catch(() => ({}))
    if (res.ok) { toast.success(out.needsApproval ? `Restored. ${backToDraft}` : 'Restored'); setMode(null); setVersions(null); router.refresh() }
    else toast.error(out.error ?? 'Could not restore')
  }

  const when = piece.scheduled_at ? new Date(piece.scheduled_at) : null
  const fullText = [piece.body, (piece.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n')
  const overLimit = piece.platform === 'twitter' && (piece.body?.length ?? 0) > 280 && !/^\s*1[/.)]/m.test(piece.body ?? '')

  return (
    <div className={cn('bg-mk-card border rounded-2xl p-4', piece.status === 'draft' ? 'border-mk-line' : 'border-mk-line/60')}>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-mk-line text-mk-body">{piece.platform}</span>
        <span className={cn('text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full', STATUS_STYLE[piece.status] ?? STATUS_STYLE.draft)}>
          {piece.status === 'draft' ? 'needs review' : piece.status}
        </span>
        {piece.edited && <span className="text-[10px] text-mk-muted">edited</span>}
        {when && <span className="text-xs text-mk-muted ml-auto">{when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {mode === 'edit' ? (
        <div className="space-y-2">
          <input className={input} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Title" />
          <textarea className={cn(input, 'min-h-[160px]')} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} />
          <input className={input} value={draft.hashtags} onChange={e => setDraft({ ...draft, hashtags: e.target.value })} placeholder="#hashtags separated by spaces" />
          <input type="datetime-local" className={input} value={draft.when} onChange={e => setDraft({ ...draft, when: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setMode(null)} className="px-3 py-1.5 text-xs text-mk-muted">Cancel</button>
            <button disabled={busy} onClick={() => call('PATCH', {
              title: draft.title, body: draft.body,
              hashtags: draft.hashtags.split(/\s+/).filter(Boolean),
              scheduled_at: draft.when ? new Date(draft.when).toISOString() : null,
            }, piece.status === 'approved' ? 'Saved. Your own edits don’t need approving again.' : 'Saved')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {piece.title && <p className="font-medium text-mk-text text-sm">{piece.title}</p>}
          <p className="text-sm text-mk-body whitespace-pre-wrap mt-1.5 leading-relaxed">{piece.body}</p>
          {(piece.hashtags ?? []).length > 0 && <p className="text-xs text-mk-accent mt-2">{(piece.hashtags ?? []).join(' ')}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-mk-muted">
            {piece.goal && <span>Goal: {piece.goal}</span>}
            {piece.cta && <span>CTA: {piece.cta}</span>}
            {piece.visual_idea && <span>Visual: {piece.visual_idea}</span>}
            {overLimit && <span className="text-mk-bad">{piece.body?.length} characters — over X’s 280 limit</span>}
          </div>
        </>
      )}

      {mode === 'refine' && (
        <div className="mt-3 flex gap-2">
          <input autoFocus className={input} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. shorter, less salesy, mention the free plan"
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) call('POST', { action: 'refine', instruction: text }, rewritten) }} />
          <button disabled={busy || !text.trim()} onClick={() => call('POST', { action: 'refine', instruction: text }, rewritten)}
            className="inline-flex items-center gap-1.5 px-3 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Rewrite
          </button>
        </div>
      )}
      {mode === 'reject' && (
        <div className="mt-3 flex gap-2">
          <input autoFocus className={input} value={text} onChange={e => setText(e.target.value)} placeholder="Why? (optional — the team will learn from it)"
            onKeyDown={e => { if (e.key === 'Enter') call('POST', { action: 'reject', reason: text }, 'Rejected') }} />
          <button disabled={busy} onClick={() => call('POST', { action: 'reject', reason: text }, text.trim() ? 'Rejected — the team will avoid this' : 'Rejected')}
            className="px-3 rounded-lg text-xs font-medium bg-mk-bad/20 text-mk-bad disabled:opacity-50">Reject</button>
        </div>
      )}
      {mode === 'history' && (
        <div className="mt-3 space-y-2">
          {versions === null ? <p className="text-xs text-mk-muted">Loading…</p> : versions.length === 0 ? <p className="text-xs text-mk-muted">No earlier versions.</p> :
            versions.map(v => (
              <div key={v.id} className="bg-mk-bg border border-mk-line rounded-lg p-2.5">
                <div className="flex items-center gap-2 text-[11px] text-mk-muted">
                  <span>{new Date(v.created_at).toLocaleString()}</span><span>·</span><span>{v.reason}</span>
                  <button onClick={() => restore(v.id)} className="ml-auto text-mk-accent hover:underline">Restore</button>
                </div>
                <p className="text-xs text-mk-body mt-1 line-clamp-3 whitespace-pre-wrap">{v.content.body}</p>
              </div>
            ))}
        </div>
      )}

      {mode !== 'edit' && (
        <div className="flex flex-wrap items-center gap-1 mt-3 pt-3 border-t border-mk-line">
          {piece.status === 'draft' && (
            <button disabled={busy}
              onClick={() => call('POST', { action: 'approve', version: piece.updated_at }, piece.platform === 'twitter' || piece.platform === 'linkedin'
                ? 'Approved — it posts at its scheduled time if the account is connected' : 'Approved')}
              title={piece.platform === 'twitter' || piece.platform === 'linkedin'
                ? 'Approving is your OK to publish: if this account is connected in Settings, MarkOS posts it at its scheduled time.' : undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-accent text-white disabled:opacity-50">
              <Check className="w-3.5 h-3.5" /> {piece.platform === 'twitter' || piece.platform === 'linkedin' ? 'Approve to post' : 'Approve'}
            </button>
          )}
          {piece.status === 'approved' && (
            <button disabled={busy} onClick={() => call('POST', { action: 'posted' }, 'Marked as posted')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-mk-ok/15 text-mk-ok disabled:opacity-50">
              <Send className="w-3.5 h-3.5" /> Mark posted
            </button>
          )}
          <CopyButton text={fullText} />
          <button onClick={() => { setDraft(draftOf(piece)); setMode('edit') }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line"><Pencil className="w-3.5 h-3.5" /> Edit</button>
          <button onClick={() => setMode(mode === 'refine' ? null : 'refine')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line"><Sparkles className="w-3.5 h-3.5" /> Rewrite…</button>
          <button onClick={openHistory} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line"><History className="w-3.5 h-3.5" /> History</button>
          {piece.status !== 'rejected' && piece.status !== 'posted' && (
            <button onClick={() => setMode(mode === 'reject' ? null : 'reject')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-bad hover:bg-mk-bad/10 ml-auto"><X className="w-3.5 h-3.5" /> Reject</button>
          )}
        </div>
      )}
    </div>
  )
}
