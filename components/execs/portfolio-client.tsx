'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookOpenCheck, Check, FolderGit2, Loader2 } from 'lucide-react'
import { Pill, tone } from '@/components/engine/ui'
import { GoToProduct } from './go-to-product'
import type { Intake } from '@/lib/engine/schemas'

export interface PortfolioItem {
  id: string
  name: string
  url: string
  repo_paths: string[]
  night_enabled: boolean
  intake_status: string
  intake: (Intake & { error?: string }) | null
}

const STATUS: Record<string, { label: string; color: 'default' | 'green' | 'amber' | 'red' | 'violet' }> = {
  none: { label: 'not read yet', color: 'default' },
  reading: { label: 'reading…', color: 'violet' },
  draft: { label: 'confirm the profile', color: 'amber' },
  confirmed: { label: 'confirmed', color: 'green' },
  failed: { label: 'reading failed', color: 'red' },
}

export function PortfolioCard({ p }: { p: PortfolioItem }) {
  const router = useRouter()
  const [paths, setPaths] = useState(p.repo_paths.join('\n'))
  const [busy, setBusy] = useState<string | null>(null)

  async function act(key: string, url: string, method: string, body: unknown, ok: string) {
    setBusy(key)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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

  const st = STATUS[p.intake_status] ?? STATUS.none
  const i = p.intake && !p.intake.error ? p.intake : null

  return (
    <div className={`${tone.card} p-5 space-y-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-lg font-semibold text-mk-text">{p.name}</p>
        <Pill color={st.color}>{st.label}</Pill>
        <span className="text-xs text-mk-muted">{p.url}</span>
        <a href={`/products/${p.id}/edit`} className={`${tone.ghostBtn} ml-auto`}>Edit details</a>
        <GoToProduct productId={p.id} href="/research" className={tone.primaryBtn}>Open workspace →</GoToProduct>
        <label className="flex items-center gap-2 text-xs text-mk-muted cursor-pointer">
          <input type="checkbox" checked={p.night_enabled} disabled={busy !== null}
            onChange={e => act('night', `/api/products/${p.id}`, 'PATCH', { night_enabled: e.target.checked }, e.target.checked ? 'Included in the night shift' : 'Left out of the night shift')} />
          Night shift works on it
        </label>
      </div>

      <div>
        <p className={tone.label}><FolderGit2 className="inline w-3.5 h-3.5 mr-1" />Folders the team may read (one per line — read-only)</p>
        <div className="flex gap-2 mt-1.5 items-start">
          <textarea className={`${tone.input} font-mono text-xs min-h-[56px]`} value={paths} onChange={e => setPaths(e.target.value)}
            placeholder="~/Developer/my-product" />
          <button className={tone.ghostBtn} disabled={busy !== null}
            onClick={() => act('paths', `/api/products/${p.id}`, 'PATCH', { repo_paths: paths.split('\n') }, 'Folders saved')}>Save</button>
        </div>
        {p.repo_paths.length === 0 && <p className="text-xs text-mk-warn mt-1">No code on this Mac — the team will work from the public site and what you tell it.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className={tone.primaryBtn} disabled={busy !== null || p.intake_status === 'reading'}
          onClick={() => act('read', `/api/products/${p.id}/intake`, 'POST', {}, 'Reading the product — this takes a minute or two')}>
          {busy === 'read' || p.intake_status === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpenCheck className="w-4 h-4" />}
          {p.intake_status === 'none' ? 'Read the product' : 'Read it again'}
        </button>
        {p.intake_status === 'draft' && (
          <button className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-ok text-mk-bg hover:opacity-90 disabled:opacity-50"
            disabled={busy !== null} onClick={() => act('confirm', `/api/products/${p.id}/intake`, 'PUT', {}, 'Profile confirmed — the team now works from it')}>
            <Check className="w-4 h-4" /> Confirm this profile
          </button>
        )}
      </div>

      {p.intake?.error && <p className="text-sm text-mk-bad">{p.intake.error}</p>}

      {i && (
        <div className="space-y-3 text-sm border-t border-mk-line pt-4">
          {i.conflicts.length > 0 && (
            <div className="bg-mk-warn/10 border border-mk-warn/30 rounded-xl px-4 py-3">
              <p className="text-mk-warn font-medium text-sm">The repo contradicts itself — decide before this goes into any copy</p>
              {i.conflicts.map((c, k) => (
                <p key={k} className="text-xs text-mk-body mt-1.5"><b>{c.topic}:</b> {c.values.join(' vs ')} <span className="text-mk-muted">({c.where})</span></p>
              ))}
            </div>
          )}
          <p className="text-mk-text">{i.one_liner}</p>
          <p className={tone.body}>{i.description}</p>
          <Grid rows={[
            ['Who it’s for', i.target_audience], ['Where', i.target_geography], ['Stage', i.stage], ['Category', i.category],
            ['Pricing', i.pricing_summary ?? 'not found'], ['Currency', i.currency ?? '—'], ['Voice', i.brand_voice ?? '—'],
            ['Colours', [i.primary_color, i.secondary_color].filter(Boolean).join(', ') || '—'],
          ]} />
          {i.offerings.length > 0 && <Lines label="Inside it" items={i.offerings.map(o => `${o.name} — ${o.what}`)} />}
          {i.goals.length > 0 && <Lines label="Goals the docs state" items={i.goals} />}
          {i.competitors.length > 0 && <Lines label="Competitors named" items={[i.competitors.join(', ')]} />}
          {i.claims_rules.length > 0 && <Lines label="Rules for public claims (become house rules)" items={i.claims_rules} />}
          {i.unknowns.length > 0 && <Lines label="Couldn’t find" items={i.unknowns} warn />}
          <p className="text-[11px] text-mk-muted">Read: {i.key_docs.join(', ') || '—'}</p>
        </div>
      )}
    </div>
  )
}

function Grid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
      {rows.map(([k, v]) => <p key={k} className="text-xs"><span className="text-mk-muted">{k}: </span><span className="text-mk-body">{v}</span></p>)}
    </div>
  )
}

function Lines({ label, items, warn }: { label: string; items: string[]; warn?: boolean }) {
  return (
    <div>
      <p className={tone.label}>{label}</p>
      <ul className="mt-1 space-y-0.5">{items.map((x, k) => <li key={k} className={warn ? 'text-xs text-mk-warn' : 'text-xs text-mk-body'}>• {x}</li>)}</ul>
    </div>
  )
}
