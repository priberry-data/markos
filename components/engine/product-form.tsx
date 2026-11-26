'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export interface ProductFields {
  id?: string
  name: string
  url: string
  description: string
  category: string
  stage: string
  target_audience: string
  target_geography: string
  currency: string
  ad_budget_monthly: string
  launch_date: string
  raising: boolean
  announcing_launch: boolean
  competitors: string
  already_tried: string
  brand_voice: string
  primary_color: string
  secondary_color: string
}

const input = 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'
const label = 'block text-xs text-mk-muted mb-1.5'

function Field({ label: l, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className={label}>{l}</span>{children}{hint && <span className="block text-[11px] text-mk-faint mt-1">{hint}</span>}</label>
}

/** Product details: everything the agents use to decide what to run and how to write. */
export function ProductForm({ initial, mode }: { initial: ProductFields; mode: 'create' | 'edit' }) {
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof ProductFields>(k: K, v: ProductFields[K]) => setF(prev => ({ ...prev, [k]: v }))

  async function save() {
    setBusy(true)
    try {
      const payload = { ...f, ad_budget_monthly: Number(f.ad_budget_monthly || 0) }
      const res = await fetch(mode === 'create' ? '/api/products' : `/api/products/${f.id}`, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not save')
      toast.success(mode === 'create' ? 'Product added — REX is researching your market' : 'Saved')
      router.push(mode === 'create' ? '/strategy' : '/portfolio')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="bg-mk-card border border-mk-line rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-mk-text">The product</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Name *"><input className={input} value={f.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="Website *" hint="REX reads it before researching."><input className={input} value={f.url} onChange={e => set('url', e.target.value)} placeholder="https://" /></Field>
        </div>
        <Field label="What it does and who it’s for"><textarea className={input} rows={3} value={f.description} onChange={e => set('description', e.target.value)} /></Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Category"><input className={input} value={f.category} onChange={e => set('category', e.target.value)} placeholder="e.g. HR tech" /></Field>
          <Field label="Stage">
            <select className={input} value={f.stage} onChange={e => set('stage', e.target.value)}>
              {['', 'Idea', 'MVP', 'Early Users', 'Growth', 'Scale'].map(s => <option key={s} value={s}>{s || '—'}</option>)}
            </select>
          </Field>
          <Field label="Target audience"><input className={input} value={f.target_audience} onChange={e => set('target_audience', e.target.value)} /></Field>
        </div>
      </section>

      <section className="bg-mk-card border border-mk-line rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-mk-text">Market & money</p>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Geography" hint="Where you sell. Sets the research focus."><input className={input} value={f.target_geography} onChange={e => set('target_geography', e.target.value)} placeholder="e.g. United States" /></Field>
          <Field label="Currency" hint="Leave blank to derive from geography."><input className={input} value={f.currency} onChange={e => set('currency', e.target.value)} placeholder="USD" maxLength={3} /></Field>
          <Field label="Monthly ad budget" hint="0 means no paid ads — MAX won’t run."><input className={input} type="number" min={0} value={f.ad_budget_monthly} onChange={e => set('ad_budget_monthly', e.target.value)} /></Field>
        </div>
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <Field label="Launch date"><input className={input} type="date" value={f.launch_date} onChange={e => set('launch_date', e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm text-mk-body pb-2">
            <input type="checkbox" checked={f.announcing_launch} onChange={e => set('announcing_launch', e.target.checked)} className="accent-mk-accent" />
            Announcing a launch <span className="text-xs text-mk-muted">(runs ECHO)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-mk-body pb-2">
            <input type="checkbox" checked={f.raising} onChange={e => set('raising', e.target.checked)} className="accent-mk-accent" />
            Currently raising <span className="text-xs text-mk-muted">(runs IVY)</span>
          </label>
        </div>
      </section>

      <section className="bg-mk-card border border-mk-line rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-mk-text">Brand</p>
        <Field label="Brand voice" hint="How you sound. SAGE starts the strategy's voice from this."><textarea className={input} rows={2} value={f.brand_voice} onChange={e => set('brand_voice', e.target.value)} placeholder="e.g. Direct, warm, no jargon. Talks like a mentor, not a salesman." /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Primary colour"><div className="flex gap-2"><input type="color" value={f.primary_color || '#6C63FF'} onChange={e => set('primary_color', e.target.value)} className="h-9 w-12 bg-transparent" /><input className={input} value={f.primary_color} onChange={e => set('primary_color', e.target.value)} placeholder="#6C63FF" /></div></Field>
          <Field label="Secondary colour"><div className="flex gap-2"><input type="color" value={f.secondary_color || '#00D4AA'} onChange={e => set('secondary_color', e.target.value)} className="h-9 w-12 bg-transparent" /><input className={input} value={f.secondary_color} onChange={e => set('secondary_color', e.target.value)} placeholder="#00D4AA" /></div></Field>
        </div>
        <Field label="Competitors you know" hint="REX researches these as well as the ones it finds."><input className={input} value={f.competitors} onChange={e => set('competitors', e.target.value)} /></Field>
        <Field label="What you’ve already tried"><input className={input} value={f.already_tried} onChange={e => set('already_tried', e.target.value)} /></Field>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={busy || !f.name.trim() || !f.url.trim()} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'create' ? 'Add product & start research' : 'Save'}
        </button>
      </div>
    </div>
  )
}
