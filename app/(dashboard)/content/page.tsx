import Link from 'next/link'
import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus } from '@/lib/engine/status'
import { FileText, Download } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { ContentPiece, type ContentPieceData } from '@/components/engine/content-piece'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const STATUSES = [
  { key: 'draft', label: 'Needs review' },
  { key: 'approved', label: 'Approved' },
  { key: 'posted', label: 'Posted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

function weekLabel(date: Date) {
  const start = new Date(date)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return `Week of ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ status?: string; platform?: string }> }) {
  const { status = 'draft', platform } = await searchParams
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  let query = supabase.from('content_items')
    .select('id, platform, content_type, title, hook, body, hashtags, cta, goal, visual_idea, scheduled_at, status, edited, updated_at')
    .eq('product_id', product.id).neq('status', 'superseded').order('scheduled_at', { ascending: true, nullsFirst: false })
  if (status !== 'all') query = query.eq('status', status)
  if (platform) query = query.eq('platform', platform)

  const [{ data: pieces }, { data: counts }, { data: brain }, status_] = await Promise.all([
    query,
    supabase.from('content_items').select('status, platform').eq('product_id', product.id).neq('status', 'superseded'),
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'content'),
  ])

  const byStatus = (s: string) => (counts ?? []).filter(c => s === 'all' || c.status === s).length
  const platforms = [...new Set((counts ?? []).map(c => c.platform))].sort()
  const href = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ status, platform, ...p }).filter(([, v]) => v) as [string, string][])
    return `/content?${q}`
  }

  // Group by week of the scheduled date.
  const groups = new Map<string, ContentPieceData[]>()
  for (const p of (pieces ?? []) as ContentPieceData[]) {
    const key = p.scheduled_at ? weekLabel(new Date(p.scheduled_at)) : 'Unscheduled'
    groups.set(key, [...(groups.get(key) ?? []), p])
  }

  return (
    <div className="p-8 max-w-5xl">
      <RunWatcher productId={product.id} />
      <PageHeader
        icon={FileText}
        title="Content"
        subtitle={<AgentMeta name="NOVA" status={status_} />}
        actions={<>
          <a href={`/api/export/content?productId=${product.id}&format=md`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text"><Download className="w-4 h-4" /> Export</a>
          {brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="content" name="NOVA" running={status_.running} />}
        </>}
      />

      {brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {STATUSES.map(s => (
              <Link key={s.key} href={href({ status: s.key })}
                className={cn('px-3 py-1.5 rounded-lg text-sm', status === s.key ? 'bg-mk-accent/15 text-mk-accent-soft' : 'text-mk-muted hover:text-mk-text')}>
                {s.label} <span className="text-xs opacity-70">{byStatus(s.key)}</span>
              </Link>
            ))}
          </div>
          {platforms.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-6">
              <Link href={href({ platform: undefined })} className={cn('px-2.5 py-1 rounded-full text-xs border', !platform ? 'border-mk-accent text-mk-accent-soft' : 'border-mk-line text-mk-muted')}>All platforms</Link>
              {platforms.map(p => (
                <Link key={p} href={href({ platform: p })} className={cn('px-2.5 py-1 rounded-full text-xs border capitalize', platform === p ? 'border-mk-accent text-mk-accent-soft' : 'border-mk-line text-mk-muted')}>{p}</Link>
              ))}
            </div>
          )}

          {(pieces ?? []).length === 0 ? (
            <Empty icon={FileText} title={status === 'draft' ? 'Nothing waiting for review' : 'Nothing here'}>
              {byStatus('all') === 0 ? 'NOVA writes your calendar once the strategy is approved.' : 'Try another filter.'}
            </Empty>
          ) : (
            <div className="space-y-8">
              {[...groups.entries()].map(([week, items]) => (
                <section key={week}>
                  <p className="text-xs text-mk-muted uppercase tracking-wider mb-3">{week}</p>
                  <div className="grid gap-3">{items.map(p => <ContentPiece key={p.id} piece={p} />)}</div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
