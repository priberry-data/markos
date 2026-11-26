import Link from 'next/link'
import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { StrategySchema } from '@/lib/engine/schemas'
import { Map, BookOpen, Loader2 } from 'lucide-react'
import { StrategyEditor } from './strategy-editor'
import { StartLaunchButton } from '@/components/engine/start-launch-button'
import { RunWatcher } from '@/components/engine/run-watcher'

export const dynamic = 'force-dynamic'

export default async function StrategyPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  const [{ data: brain }, { count: sourceCount }, { data: revising }] = await Promise.all([
    supabase.from('product_brains').select('strategy, strategy_status, strategy_approved_at, strategy_output_id').eq('product_id', product.id).maybeSingle(),
    supabase.from('sources').select('id', { count: 'exact', head: true }).eq('product_id', product.id),
    supabase.from('agent_runs').select('id, run_type, phase').eq('product_id', product.id).eq('status', 'running')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const parsed = brain?.strategy ? StrategySchema.safeParse(brain.strategy) : null
  const strategy = parsed?.success ? parsed.data : null
  const working = revising && ['research', 'strategy'].includes(revising.phase ?? '')

  return (
    <div className="p-8 max-w-5xl">
      <RunWatcher productId={product.id} />
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-mk-text flex items-center gap-3">
            <Map className="w-6 h-6 text-mk-accent" /> Strategy
          </h1>
          <p className="text-mk-muted mt-1 text-sm">
            Written by SAGE for {product.name}
            {sourceCount ? <> from <Link href="/research" className="text-mk-accent hover:underline">{sourceCount} live research sources</Link></> : null}
          </p>
        </div>
        {sourceCount ? (
          <Link href="/research" className="flex items-center gap-1.5 text-sm text-mk-muted hover:text-mk-text">
            <BookOpen className="w-4 h-4" /> View research
          </Link>
        ) : null}
      </div>

      {working && (
        <div className="mb-5 flex items-center gap-3 bg-mk-accent/10 border border-mk-accent/30 rounded-2xl px-5 py-4">
          <Loader2 className="w-4 h-4 text-mk-accent animate-spin" />
          <p className="text-sm text-mk-body">
            {revising!.phase === 'research' ? 'REX is researching your market…' : 'SAGE is writing the strategy…'} This page updates when it’s ready.
          </p>
        </div>
      )}

      {strategy ? (
        <StrategyEditor
          key={`${brain!.strategy_output_id}-${brain!.strategy_status}-${brain!.strategy_approved_at}`}
          productId={product.id}
          initial={strategy}
          status={brain!.strategy_status === 'approved' ? 'approved' : 'draft'}
          approvedAt={brain!.strategy_approved_at}
        />
      ) : !working ? (
        <div className="bg-mk-card border border-dashed border-mk-line rounded-2xl p-12 text-center">
          <Map className="w-10 h-10 text-mk-faint mx-auto mb-3" />
          <p className="text-mk-body font-medium">No strategy yet</p>
          <p className="text-sm text-mk-muted mt-1 mb-5">
            REX researches your market on the live web, then SAGE drafts a strategy for you to approve.
          </p>
          <StartLaunchButton productId={product.id} />
        </div>
      ) : null}
    </div>
  )
}
