'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, AlertCircle, Loader2, Trash2, Plus } from 'lucide-react'
import { YourAi, type AiStatus } from '@/components/engine/your-ai'

interface Props {
  profile: { name: string | null; role: string | null; company: string | null; sender_email: string | null; run_budget_usd: number }
  providers: { resend: boolean; resendFrom: boolean }
  ai: AiStatus
  agents: Array<{ key: string; name: string; title: string; current: string }>
  models: Array<{ value: string; label: string; note: string }>
  product: { id: string; name: string } | null
  rules: Array<{ id: string; rule: string; origin: string }>
  connected: Array<{ platform: string; username: string | null }>
}

const card = 'bg-mk-card border border-mk-line rounded-2xl p-5'
const input = 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent'
const btn = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-50'

function Status({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok
    ? <span className="inline-flex items-center gap-1.5 text-xs text-mk-ok"><Check className="w-3.5 h-3.5" />{yes}</span>
    : <span className="inline-flex items-center gap-1.5 text-xs text-mk-warn"><AlertCircle className="w-3.5 h-3.5" />{no}</span>
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong')
  return out
}

export function SettingsClient({ profile, providers, ai, agents, models, product, rules, connected }: Props) {
  const router = useRouter()
  const [p, setP] = useState({ ...profile, run_budget_usd: String(profile.run_budget_usd) })
  const [choices, setChoices] = useState(Object.fromEntries(agents.map(a => [a.key, a.current])))
  const [rule, setRule] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key)
    try { await fn(); toast.success(ok); router.refresh() } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-6">
      <section className={card}>
        <p className="font-semibold text-mk-text mb-1">Your AI</p>
        <p className="text-xs text-mk-muted mb-4">Which AI runs your team. Use your Claude plan, any API key, or a free model on your own computer. Nothing leaves this computer except the calls to the AI you pick.</p>
        <YourAi status={ai} />
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="font-semibold text-mk-text mb-1">Email (Resend) <span className="text-xs font-normal text-mk-muted">— for sending outreach</span></p>
            <p className="text-xs text-mk-muted">RESEND_API_KEY and RESEND_FROM_EMAIL in .env.local (an address on a domain verified in Resend). Restart MarkOS after changing them.</p></div>
          <Status ok={providers.resend && providers.resendFrom} yes="Ready to send" no={providers.resend ? 'RESEND_FROM_EMAIL not set' : 'Not set — sending is off'} />
        </div>
      </section>

      <section className={card}>
        <p className="font-semibold text-mk-text mb-1">Spending</p>
        <p className="text-xs text-mk-muted mb-4">A run stops cleanly before its AI work passes this value. On Claude Code nothing is billed per call — this is what the same work would cost on the API, so it works as a cap on how much of your plan one run can use. Models on your computer cost nothing. MarkOS knows the cost of Gemini, the Anthropic API and OpenRouter calls; for other API keys it can’t see prices, so this cap can’t stop them — set a spending limit with that provider.</p>
        <div className="flex items-end gap-3">
          <label className="block w-48"><span className="block text-xs text-mk-muted mb-1.5">Max per run (USD)</span>
            <input className={input} type="number" min={0.05} step={0.05} value={p.run_budget_usd} onChange={e => setP({ ...p, run_budget_usd: e.target.value })} /></label>
          <button className={btn} disabled={busy !== null} onClick={() => run('budget', () => send('/api/profile', 'PATCH', { run_budget_usd: Number(p.run_budget_usd) }), 'Budget saved')}>
            {busy === 'budget' && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </section>

      <section className={card}>
        <p className="font-semibold text-mk-text mb-1">Models</p>
        <p className="text-xs text-mk-muted mb-4">Which model each agent uses. Agents follow your team’s AI unless you set one apart here. Web searches run on an AI that can search (see Your AI).</p>
        <div className="space-y-2">
          {agents.map(a => (
            <div key={a.key} className="flex flex-wrap items-center justify-between gap-3 bg-mk-bg border border-mk-line rounded-xl px-4 py-2.5">
              <span className="text-sm text-mk-text">{a.name} <span className="text-mk-muted">· {a.title}</span></span>
              <select value={choices[a.key]} onChange={e => setChoices({ ...choices, [a.key]: e.target.value })}
                className="bg-mk-card border border-mk-line rounded-lg px-3 py-1.5 text-xs text-mk-text">
                {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        <button className={`${btn} mt-4`} disabled={busy !== null} onClick={() => run('models', () => send('/api/settings/models', 'POST', choices), 'Models saved')}>
          {busy === 'models' && <Loader2 className="w-4 h-4 animate-spin" />} Save models
        </button>
      </section>

      {product && (
        <section className={card}>
          <p className="font-semibold text-mk-text mb-1">House rules · {product.name}</p>
          <p className="text-xs text-mk-muted mb-4">Every agent follows these. They’re added when you reject something with a reason, or you can write your own.</p>
          <div className="space-y-2">
            {rules.length === 0 && <p className="text-sm text-mk-faint">No rules yet.</p>}
            {rules.map(r => (
              <div key={r.id} className="flex items-center gap-3 bg-mk-bg border border-mk-line rounded-xl px-4 py-2.5">
                <span className="text-sm text-mk-body flex-1">{r.rule}</span>
                <span className="text-[10px] uppercase text-mk-faint">{r.origin}</span>
                <button onClick={() => run(`rule-${r.id}`, () => send(`/api/house-rules/${r.id}`, 'DELETE'), 'Rule removed')} className="text-mk-faint hover:text-mk-bad"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <input className={input} value={rule} onChange={e => setRule(e.target.value)} placeholder="e.g. Never mention pricing. Always write in British English." />
            <button className={btn} disabled={!rule.trim() || busy !== null} onClick={() => run('add-rule', async () => { await send('/api/house-rules', 'POST', { productId: product.id, rule }); setRule('') }, 'Rule added')}>
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </section>
      )}

      <section className={card}>
        <p className="font-semibold text-mk-text mb-4">You</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {(['name', 'role', 'company', 'sender_email'] as const).map(k => (
            <label key={k} className="block"><span className="block text-xs text-mk-muted mb-1.5">{k === 'sender_email' ? 'Reply-to email for outreach' : k[0].toUpperCase() + k.slice(1)}</span>
              <input className={input} value={p[k] ?? ''} onChange={e => setP({ ...p, [k]: e.target.value })} /></label>
          ))}
        </div>
        <button className={`${btn} mt-4`} disabled={busy !== null} onClick={() => run('profile', () => send('/api/profile', 'PATCH', { name: p.name, role: p.role, company: p.company, sender_email: p.sender_email }), 'Saved')}>
          {busy === 'profile' && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </section>

      <section className={card}>
        <p className="font-semibold text-mk-text mb-1">Social accounts</p>
        <p className="text-xs text-mk-muted mb-4">Optional. Connect to publish approved posts directly. Needs the platform’s app credentials in .env.local.</p>
        <div className="flex flex-wrap gap-3">
          {[{ id: 'twitter', name: 'X / Twitter', url: '/api/auth/twitter' }, { id: 'linkedin', name: 'LinkedIn', url: '/api/auth/linkedin' }].map(s => {
            const c = connected.find(x => x.platform === s.id)
            return c
              ? <span key={s.id} className="px-4 py-2 rounded-lg text-sm bg-mk-ok/10 text-mk-ok">{s.name}: {c.username ?? 'connected'}</span>
              : <a key={s.id} href={s.url} className="px-4 py-2 rounded-lg text-sm border border-mk-line text-mk-text hover:border-mk-accent">Connect {s.name}</a>
          })}
        </div>
      </section>
    </div>
  )
}
