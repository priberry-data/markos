import Link from 'next/link'
import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { pendingCounts } from '@/lib/engine/status'
import { CheckSquare, Map } from 'lucide-react'
import { PageHeader, Empty } from '@/components/engine/ui'
import { RunWatcher } from '@/components/engine/run-watcher'
import { ContentPiece, type ContentPieceData } from '@/components/engine/content-piece'
import { OutreachCard, type OutreachTarget } from '@/components/engine/outreach-card'
import { BulkApproveButton } from '@/components/engine/bulk-approve-button'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = 'content' } = await searchParams
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  const counts = await pendingCounts(product.id)
  const [{ data: pieces }, { data: targets }] = await Promise.all([
    tab === 'content'
      ? supabase.from('content_items').select('id, platform, content_type, title, hook, body, hashtags, cta, goal, visual_idea, scheduled_at, status, edited')
          .eq('product_id', product.id).eq('status', 'draft').order('scheduled_at')
      : Promise.resolve({ data: [] }),
    tab === 'outreach'
      ? supabase.from('outreach_targets').select('*').eq('product_id', product.id).eq('status', 'identified').order('verified', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])
  const canEmail = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
  const tabs = [
    { key: 'content', label: 'Content', n: counts.content },
    { key: 'outreach', label: 'Outreach', n: counts.outreach },
  ]

  return (
    <div className="p-8 max-w-5xl">
      <RunWatcher productId={product.id} />
      <PageHeader icon={CheckSquare} title="Approvals"
        subtitle="Everything the team wrote that’s waiting for you. Approve, edit, rewrite, or reject with a reason — the team learns from rejections."
        actions={tab === 'content' && counts.content > 0 ? <BulkApproveButton productId={product.id} count={counts.content} /> : null} />

      {counts.strategy > 0 && (
        <Link href="/strategy" className="flex items-center gap-3 mb-5 bg-mk-warn/10 border border-mk-warn/30 rounded-2xl px-5 py-4 hover:border-mk-warn/60">
          <Map className="w-5 h-5 text-mk-warn" />
          <div className="flex-1"><p className="text-sm font-medium text-mk-warn">The strategy is waiting for your approval</p><p className="text-xs text-mk-muted">Nothing else is written until you approve it.</p></div>
          <span className="text-xs text-mk-warn">Review →</span>
        </Link>
      )}

      <div className="flex gap-2 mb-5">
        {tabs.map(t => (
          <Link key={t.key} href={`/approvals?tab=${t.key}`} className={cn('px-3 py-1.5 rounded-lg text-sm', tab === t.key ? 'bg-mk-accent/15 text-mk-accent-soft' : 'text-mk-muted hover:text-mk-text')}>
            {t.label} <span className="text-xs opacity-70">{t.n}</span>
          </Link>
        ))}
      </div>

      {tab === 'content' && ((pieces ?? []).length === 0
        ? <Empty icon={CheckSquare} title="No content waiting">You’re all caught up.</Empty>
        : <div className="grid gap-3">{(pieces as ContentPieceData[]).map(p => <ContentPiece key={p.id} piece={p} />)}</div>)}
      {tab === 'outreach' && ((targets ?? []).length === 0
        ? <Empty icon={CheckSquare} title="No outreach waiting">You’re all caught up.</Empty>
        : <div className="grid gap-3">{(targets as OutreachTarget[]).map(t => <OutreachCard key={t.id} target={t} canEmail={canEmail} />)}</div>)}
    </div>
  )
}
