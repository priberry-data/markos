import Link from 'next/link'
import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { DistributionSchema } from '@/lib/engine/schemas'
import { Megaphone, Users, Download } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, SectionTitle } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { CopyButton } from '@/components/engine/copy-button'
import { OutreachCard, type OutreachTarget } from '@/components/engine/outreach-card'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const VIEWS = [
  { key: 'review', label: 'To review', statuses: ['identified'] },
  { key: 'active', label: 'In progress', statuses: ['approved', 'contacted', 'replied', 'in_talks'] },
  { key: 'done', label: 'Done', statuses: ['closed', 'not_a_fit', 'rejected'] },
]

export default async function DistributionPage({ searchParams }: { searchParams: Promise<{ view?: string; type?: string }> }) {
  const { view = 'review', type } = await searchParams
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  const current = VIEWS.find(v => v.key === view) ?? VIEWS[0]
  let q = supabase.from('outreach_targets').select('*').eq('product_id', product.id).in('status', current.statuses)
    .order('verified', { ascending: false }).order('created_at')
  if (type) q = q.eq('type', type)

  const [{ data: targets }, { data: all }, { data: brain }, status, output] = await Promise.all([
    q,
    supabase.from('outreach_targets').select('status, type').eq('product_id', product.id).neq('status', 'superseded'),
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'distribution'),
    currentOutput(product.id, 'distribution'),
  ])
  const plan = output ? DistributionSchema.safeParse(output.content_json) : null
  const canEmail = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
  const count = (statuses: string[]) => (all ?? []).filter(t => statuses.includes(t.status)).length
  const types = [...new Set((all ?? []).map(t => t.type))].sort()
  const href = (p: Record<string, string | undefined>) => `/distribution?${new URLSearchParams(Object.entries({ view, type, ...p }).filter(([, v]) => v) as [string, string][])}`

  return (
    <div className="p-8 max-w-5xl">
      <RunWatcher productId={product.id} />
      <PageHeader
        icon={Megaphone}
        title="Distribution"
        subtitle={<AgentMeta name="REACH" status={status} />}
        actions={<>
          <a href={`/api/export/distribution?productId=${product.id}&format=csv`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text"><Download className="w-4 h-4" /> Export CSV</a>
          {brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="distribution" name="REACH" running={status.running} />}
        </>}
      />

      {brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : (
        <>
          <p className="text-sm text-mk-muted mb-4">
            Communities, creators, publications and podcasts REACH found on the live web. Each links to the page it was found on;
            emails are only ever sent to addresses you confirm{canEmail ? '' : ' (sending is off until RESEND_API_KEY and RESEND_FROM_EMAIL are set)'}.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {VIEWS.map(v => (
              <Link key={v.key} href={href({ view: v.key })}
                className={cn('px-3 py-1.5 rounded-lg text-sm', view === v.key ? 'bg-mk-accent/15 text-mk-accent-soft' : 'text-mk-muted hover:text-mk-text')}>
                {v.label} <span className="text-xs opacity-70">{count(v.statuses)}</span>
              </Link>
            ))}
          </div>
          {types.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-6">
              <Link href={href({ type: undefined })} className={cn('px-2.5 py-1 rounded-full text-xs border', !type ? 'border-mk-accent text-mk-accent-soft' : 'border-mk-line text-mk-muted')}>All</Link>
              {types.map(t => <Link key={t} href={href({ type: t })} className={cn('px-2.5 py-1 rounded-full text-xs border capitalize', type === t ? 'border-mk-accent text-mk-accent-soft' : 'border-mk-line text-mk-muted')}>{t}s</Link>)}
            </div>
          )}

          {(targets ?? []).length === 0 ? (
            <Empty icon={Megaphone} title="Nothing here">{(all ?? []).length === 0 ? 'REACH finds your distribution channels once the strategy is approved.' : 'Try another view.'}</Empty>
          ) : (
            <div className="grid gap-3">
              {(targets as OutreachTarget[]).map(t => <OutreachCard key={t.id} target={t} canEmail={canEmail} />)}
            </div>
          )}

          {plan?.success && plan.data.community_posts.length > 0 && view === 'review' && (
            <Card className="mt-8">
              <SectionTitle icon={Users}>Ready-to-post community posts</SectionTitle>
              <div className="space-y-3">
                {plan.data.community_posts.map((p, i) => (
                  <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-mk-accent">{p.community}</p>
                      <div className="ml-auto"><CopyButton text={`${p.title}\n\n${p.body}`} /></div>
                    </div>
                    <p className="font-medium text-mk-text text-sm mt-1">{p.title}</p>
                    <p className="text-sm text-mk-body whitespace-pre-wrap mt-1">{p.body}</p>
                    <p className="text-xs text-mk-warn mt-2">Community rules: {p.rules_to_respect}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
