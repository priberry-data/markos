import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { PRSchema } from '@/lib/engine/schemas'
import { Newspaper, BookOpen, Lightbulb, User } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, SectionTitle } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { CopyButton } from '@/components/engine/copy-button'
import { OptionalAgentOff } from '@/components/engine/optional-agent'

export const dynamic = 'force-dynamic'

export default async function PRPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: brain }, status, output] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'pr'),
    currentOutput(product.id, 'pr'),
  ])
  const parsed = output ? PRSchema.safeParse(output.content_json) : null
  const pr = parsed?.success ? parsed.data : null
  const enabled = Boolean(product.announcing_launch)

  return (
    <div className="p-8 max-w-4xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader icon={Newspaper} title="PR & Launch" subtitle={<AgentMeta name="ECHO" status={status} />}
        actions={enabled && brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="pr" name="ECHO" running={status.running} />} />
      {!enabled && !pr ? (
        <OptionalAgentOff icon={Newspaper} title="ECHO is off for this product" reason="ECHO writes launch press materials when you’re announcing a launch." productId={product.id} />
      ) : brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : !pr ? (
        <Empty icon={Newspaper} title="No launch materials yet">Run ECHO to write your launch story and press release.</Empty>
      ) : (
        <>
          <Card>
            <SectionTitle icon={BookOpen}>{pr.narrative.headline}</SectionTitle>
            <p className="text-sm text-mk-body whitespace-pre-wrap">{pr.narrative.story}</p>
          </Card>
          <Card>
            <SectionTitle icon={Newspaper} right={<CopyButton text={`${pr.press_release.headline}\n${pr.press_release.subhead}\n\n${pr.press_release.body}\n\n${pr.press_release.boilerplate}`} label="Copy release" />}>Press release</SectionTitle>
            <p className="text-lg font-semibold text-mk-text">{pr.press_release.headline}</p>
            <p className="text-sm text-mk-muted mt-1">{pr.press_release.subhead}</p>
            <p className="text-sm text-mk-body whitespace-pre-wrap mt-4 leading-relaxed">{pr.press_release.body}</p>
            <p className="text-xs text-mk-muted whitespace-pre-wrap mt-4 pt-4 border-t border-mk-line">{pr.press_release.boilerplate}</p>
          </Card>
          <Card>
            <SectionTitle icon={Lightbulb}>Story angles</SectionTitle>
            <div className="space-y-3">{pr.angles.map((a, i) => (
              <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-3">
                <p className="text-sm text-mk-text">{a.angle}</p>
                <p className="text-xs text-mk-muted mt-1">{a.why_newsworthy} · best for {a.best_for}</p>
              </div>
            ))}</div>
            <p className="text-xs text-mk-muted mt-3">Publications and journalists to pitch are on the Distribution page, each with a source.</p>
          </Card>
          <Card><SectionTitle icon={User}>Founder story</SectionTitle><p className="text-sm text-mk-body whitespace-pre-wrap">{pr.founder_story}</p></Card>
        </>
      )}
    </div>
  )
}
