import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { AGENTS, AGENT_KEYS, MODEL_CHOICES, OPEN_PROVIDERS, modelFor, refToString, setModelOverrides, type AgentKey } from '@/lib/llm/models'
import { aiStatus, modelLabel } from '@/lib/llm/ai-status'
import { Settings } from 'lucide-react'
import { Card, PageHeader, SectionTitle } from '@/components/engine/ui'
import { WorkingDay } from '@/components/execs/office-client'
import { DataConnections } from '@/components/execs/data-connections'
import { dataConnections } from '@/lib/engine/execs/data-team'
import { SettingsClient } from './settings-client'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  const [{ data: profile }, { data: tokens }, { data: rules }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', 1).single(),
    // Only platform + username reach the browser — never the tokens themselves.
    supabase.from('social_tokens').select('platform, username'),
    product ? supabase.from('house_rules').select('id, rule, origin').eq('product_id', product.id).eq('active', true).order('created_at') : Promise.resolve({ data: [] }),
  ])
  setModelOverrides((profile?.agent_models ?? {}) as Partial<Record<AgentKey, string>>)

  const team = modelFor('chief_of_staff')
  // Every model in use shows in the per-agent lists, plus the team's own AI.
  const extra = [team, ...AGENT_KEYS.map(k => modelFor(k))].filter(r => OPEN_PROVIDERS.includes(r.provider))
  const models = [
    ...MODEL_CHOICES.map(m => ({ value: refToString(m.ref), label: m.label, note: m.note })),
    ...[...new Set(extra.map(refToString))].map(v => ({ value: v, label: modelLabel(extra.find(r => refToString(r) === v)!), note: '' })),
  ]

  return (
    <div className="p-8 max-w-3xl">
      <PageHeader icon={Settings} title="Settings" />
      <div className="mb-6"><DataConnections conns={await dataConnections()} /></div>
      <Card className="mb-6">
        <SectionTitle>Your working day <span className="text-xs font-normal text-mk-muted">· Myra books meetings only inside your meeting windows; the rest is focus time</span></SectionTitle>
        <WorkingDay p={{
          work_start: profile?.work_start ?? '10:00', work_end: profile?.work_end ?? '19:00',
          meeting_windows: profile?.meeting_windows ?? '11:00-13:00,16:00-18:00',
          max_meetings_per_day: Number(profile?.max_meetings_per_day ?? 3), night_budget_usd: Number(profile?.night_budget_usd ?? 20),
        }} />
      </Card>
      <SettingsClient
        profile={{ name: profile?.name ?? '', role: profile?.role ?? '', company: profile?.company ?? '', sender_email: profile?.sender_email ?? '', run_budget_usd: Number(profile?.run_budget_usd ?? 1) }}
        providers={{ resend: Boolean(process.env.RESEND_API_KEY), resendFrom: Boolean(process.env.RESEND_FROM_EMAIL) }}
        ai={aiStatus()}
        agents={AGENT_KEYS.filter(k => k !== 'assistant').map(k => ({ key: k, name: AGENTS[k].name, title: AGENTS[k].title, current: refToString(modelFor(k)) }))}
        models={models}
        product={product ? { id: product.id, name: product.name } : null}
        rules={(rules ?? []) as Array<{ id: string; rule: string; origin: string }>}
        connected={(tokens ?? []) as Array<{ platform: string; username: string | null }>}
      />
    </div>
  )
}
