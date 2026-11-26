import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { gatherMetrics } from '@/lib/engine/agents/review'
import { WeeklyReviewSchema } from '@/lib/engine/schemas'
import { LineChart, Activity, PenLine, ThumbsUp, ThumbsDown, ListChecks, Compass } from 'lucide-react'
import { PageHeader, Card, SectionTitle, Empty, NeedsStrategy } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { AddMetric, ApplyChanges } from '@/components/engine/review-actions'

export const dynamic = 'force-dynamic'

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="bg-mk-bg border border-mk-line rounded-xl p-3"><p className="text-xl font-semibold text-mk-text">{value}</p><p className="text-xs text-mk-muted">{label}</p></div>
}

export default async function ReviewPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: brain }, status, output, metrics, { data: numbers }] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'review'),
    currentOutput(product.id, 'review'),
    gatherMetrics(product.id),
    supabase.from('metric_entries').select('metric, value, note, recorded_for').eq('product_id', product.id).order('recorded_for', { ascending: false }).limit(10),
  ])
  const parsed = output ? WeeklyReviewSchema.safeParse(output.content_json) : null
  const review = parsed?.success ? parsed.data : null
  const replyRate = metrics.outreach.contacted ? `${Math.round((metrics.outreach.replied / metrics.outreach.contacted) * 100)}%` : '—'

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader icon={LineChart} title="Weekly review" subtitle={<AgentMeta name="PULSE" status={status} />}
        actions={brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="review" name="PULSE" label="Run this week’s review" running={status.running} />} />

      {brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : (
        <>
          <Card>
            <SectionTitle icon={Activity}>Last 7 days — what actually happened</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Pieces posted" value={metrics.content.posted} />
              <Stat label="Approved, not yet posted" value={metrics.content.approved} />
              <Stat label="Rejected" value={metrics.content.rejected} />
              <Stat label="Edited by you" value={metrics.content.edited} />
              <Stat label="People contacted" value={metrics.outreach.contacted} />
              <Stat label="Reply rate" value={replyRate} />
              <Stat label="In talks / won" value={`${metrics.outreach.inTalks} / ${metrics.outreach.won}`} />
              <Stat label="AI spend" value={`$${metrics.aiCostUsd.toFixed(2)}`} />
            </div>
            <p className="text-xs text-mk-muted mt-3">MarkOS only counts what it can see. Traffic, signups and revenue come from you, below.</p>
          </Card>

          <Card>
            <SectionTitle icon={PenLine}>Your numbers</SectionTitle>
            <AddMetric productId={product.id} />
            {(numbers ?? []).length > 0 && (
              <ul className="mt-4 space-y-1">{(numbers ?? []).map((n, i) => (
                <li key={i} className="text-sm text-mk-body"><span className="text-mk-muted">{n.recorded_for}</span> · {n.metric}: <span className="text-mk-text">{Number(n.value).toLocaleString()}</span>{n.note ? <span className="text-mk-muted"> — {n.note}</span> : null}</li>
              ))}</ul>
            )}
          </Card>

          {!review ? (
            <Empty icon={LineChart} title="No review yet">Run PULSE at the end of a week. It reviews only what happened — never made-up numbers.</Empty>
          ) : (
            <>
              <Card><SectionTitle icon={LineChart}>Summary</SectionTitle><p className="text-sm text-mk-body whitespace-pre-wrap">{review.summary}</p></Card>
              <div className="grid md:grid-cols-2 gap-5">
                <Card><SectionTitle icon={ThumbsUp}>What worked</SectionTitle><ul className="space-y-1.5">{review.what_worked.map((w, i) => <li key={i} className="text-sm text-mk-body">• {w}</li>)}</ul></Card>
                <Card><SectionTitle icon={ThumbsDown}>What didn’t</SectionTitle><ul className="space-y-1.5">{review.what_didnt.map((w, i) => <li key={i} className="text-sm text-mk-body">• {w}</li>)}</ul></Card>
              </div>
              <Card><SectionTitle icon={ListChecks}>Next week</SectionTitle>
                <ul className="space-y-2">{review.recommendations.map((r, i) => <li key={i} className="text-sm"><span className="text-mk-text">{r.change}</span><span className="block text-xs text-mk-muted">{r.why}</span></li>)}</ul>
              </Card>
              {review.strategy_changes.length > 0 && (
                <Card>
                  <SectionTitle icon={Compass} right={<ApplyChanges productId={product.id} changes={review.strategy_changes} />}>Suggested strategy changes</SectionTitle>
                  <ul className="space-y-2">{review.strategy_changes.map((c, i) => (
                    <li key={i} className="bg-mk-bg border border-mk-line rounded-xl p-3 text-sm"><span className="text-xs text-mk-accent uppercase">{c.area}</span><p className="text-mk-text">{c.change}</p><p className="text-xs text-mk-muted">{c.why}</p></li>
                  ))}</ul>
                  <p className="text-xs text-mk-muted mt-3">Nothing changes until you approve SAGE’s revised draft.</p>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
