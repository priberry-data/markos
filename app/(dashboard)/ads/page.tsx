import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { AdsSchema } from '@/lib/engine/schemas'
import { adBudget, currencyFor } from '@/lib/engine/brain'
import { Target } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, Pill, money } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { CopyButton } from '@/components/engine/copy-button'
import { OptionalAgentOff } from '@/components/engine/optional-agent'

export const dynamic = 'force-dynamic'

export default async function AdsPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: brain }, status, output] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'ads'),
    currentOutput(product.id, 'ads'),
  ])
  const parsed = output ? AdsSchema.safeParse(output.content_json) : null
  const ads = parsed?.success ? parsed.data : null
  const budget = adBudget(product as never)
  const currency = currencyFor(product as never)

  return (
    <div className="p-8 max-w-4xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader icon={Target} title="Paid ads" subtitle={<AgentMeta name="MAX" status={status} />}
        actions={budget > 0 && brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="ads" name="MAX" running={status.running} />} />
      {budget === 0 && !ads ? (
        <OptionalAgentOff icon={Target} title="MAX is off for this product" reason="He drafts ad campaigns sized to your monthly ad budget. None is set." productId={product.id} />
      ) : brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : !ads ? (
        <Empty icon={Target} title="No campaign drafts yet">Run MAX to draft campaigns within {money(budget, currency)} a month.</Empty>
      ) : (
        <>
          <p className="text-sm text-mk-muted">Drafts only — nothing is ever spent. Total {money(ads.monthly_budget, ads.currency)} / month.</p>
          {ads.campaigns.map((c, i) => (
            <Card key={i}>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <p className="font-semibold text-mk-text">{c.platform}</p><Pill color="violet">{c.objective}</Pill>
                <span className="ml-auto text-sm text-mk-ok">{money(c.monthly_budget, ads.currency)} / mo</span>
              </div>
              <p className="text-sm text-mk-body">Audience: {c.audience}</p>
              <p className="text-xs text-mk-muted mt-1">Measure: {c.success_metric}</p>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                {c.ads.map((a, j) => (
                  <div key={j} className="bg-mk-bg border border-mk-line rounded-xl p-3">
                    <div className="flex items-start gap-2"><p className="text-sm font-medium text-mk-text flex-1">{a.headline}</p><CopyButton text={`${a.headline}\n${a.primary_text}\n${a.cta}`} label="" /></div>
                    <p className="text-sm text-mk-body mt-1">{a.primary_text}</p>
                    <p className="text-xs text-mk-accent mt-2">{a.cta}</p>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {ads.notes && <Card><p className="text-sm text-mk-body whitespace-pre-wrap">{ads.notes}</p></Card>}
        </>
      )}
    </div>
  )
}
