import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { InvestorSchema } from '@/lib/engine/schemas'
import { Landmark, Presentation, Users } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, SectionTitle, Cite } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { OptionalAgentOff } from '@/components/engine/optional-agent'

export const dynamic = 'force-dynamic'

export default async function InvestorPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: brain }, status, output] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'investor'),
    currentOutput(product.id, 'investor'),
  ])
  const parsed = output ? InvestorSchema.safeParse(output.content_json) : null
  const inv = parsed?.success ? parsed.data : null
  const enabled = Boolean(product.raising)

  return (
    <div className="p-8 max-w-4xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader icon={Landmark} title="Fundraising" subtitle={<AgentMeta name="IVY" status={status} />}
        actions={enabled && brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="investor" name="IVY" running={status.running} />} />
      {!enabled && !inv ? (
        <OptionalAgentOff icon={Landmark} title="IVY is off for this product" reason="She finds sourced investor targets and shapes your narrative when you’re raising." productId={product.id} />
      ) : brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : !inv ? (
        <Empty icon={Landmark} title="No fundraising brief yet">Run IVY to find investors actively backing your category.</Empty>
      ) : (
        <>
          <Card><SectionTitle icon={Landmark}>Narrative</SectionTitle><p className="text-sm text-mk-body whitespace-pre-wrap">{inv.narrative}</p></Card>
          <Card>
            <SectionTitle icon={Users}>Investors to approach</SectionTitle>
            <div className="space-y-2">{inv.targets.map((t, i) => (
              <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-3">
                <p className="text-sm text-mk-text">{t.name}{t.firm ? <span className="text-mk-muted"> · {t.firm}</span> : null}<Cite url={t.source} /></p>
                <p className="text-xs text-mk-muted mt-1">{t.why_fit}</p>
              </div>
            ))}</div>
          </Card>
          <Card>
            <SectionTitle icon={Presentation}>Pitch outline</SectionTitle>
            <ol className="space-y-3">{inv.pitch_outline.map((s, i) => (
              <li key={i}><p className="text-sm text-mk-text">{i + 1}. {s.slide}</p><ul className="mt-1 ml-4 space-y-0.5">{s.points.map((p, j) => <li key={j} className="text-xs text-mk-body">• {p}</li>)}</ul></li>
            ))}</ol>
          </Card>
        </>
      )}
    </div>
  )
}
