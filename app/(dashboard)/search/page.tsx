import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { SearchSchema } from '@/lib/engine/schemas'
import { Search, KeyRound, MessageCircleQuestion, FileText, Bot, Zap, Download } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, SectionTitle, Cite, Pill } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'

export const dynamic = 'force-dynamic'

export default async function SearchPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  const [{ data: brain }, status, output] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'search'),
    currentOutput(product.id, 'search'),
  ])
  const parsed = output ? SearchSchema.safeParse(output.content_json) : null
  const s = parsed?.success ? parsed.data : null
  const intentColor = { informational: 'default', commercial: 'violet', transactional: 'green', navigational: 'amber' } as const

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader
        icon={Search}
        title="Search & AI visibility"
        subtitle={<AgentMeta name="QUINN" status={status} />}
        actions={<>
          {s && <a href={`/api/export/search?productId=${product.id}&format=csv`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text"><Download className="w-4 h-4" /> Keywords CSV</a>}
          {brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="search" name="QUINN" running={status.running} />}
        </>}
      />

      {brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : !s ? (
        <Empty icon={Search} title="No search plan yet">QUINN researches what your audience searches for once the strategy is approved.</Empty>
      ) : (
        <>
          <Card>
            <SectionTitle icon={KeyRound}>Keywords</SectionTitle>
            <p className="text-xs text-mk-muted mb-4">Phrases from live search results. A volume is shown only when a page QUINN read states one — otherwise it’s left blank rather than guessed.</p>
            <div className="space-y-5">
              {s.keyword_clusters.map((c, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-sm font-medium text-mk-text">{c.theme}</p>
                    <Pill color={intentColor[c.intent]}>{c.intent}</Pill>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-mk-muted"><th className="py-1.5 font-normal">Phrase</th><th className="font-normal">Monthly volume</th><th className="font-normal">Difficulty</th><th className="font-normal">Source</th></tr></thead>
                      <tbody>
                        {c.keywords.map((k, j) => (
                          <tr key={j} className="border-t border-mk-line">
                            <td className="py-2 text-mk-body">{k.keyword}</td>
                            <td className="text-mk-body">{k.volume ?? <span className="text-mk-faint">not stated</span>}</td>
                            <td className="text-mk-body">{k.difficulty ?? <span className="text-mk-faint">—</span>}</td>
                            <td><Cite url={k.source} className="ml-0" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle icon={FileText}>Articles to write</SectionTitle>
            <div className="grid md:grid-cols-2 gap-3">
              {s.articles.map((a, i) => (
                <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4">
                  <p className="font-medium text-mk-text text-sm">{a.title}</p>
                  <p className="text-xs text-mk-accent mt-1">Targets “{a.target_keyword}”</p>
                  <p className="text-xs text-mk-muted mt-2">{a.why}</p>
                  <ol className="mt-2 space-y-1 list-decimal list-inside text-xs text-mk-body">{a.outline.map((o, j) => <li key={j}>{o}</li>)}</ol>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-5">
            <Card>
              <SectionTitle icon={MessageCircleQuestion}>Questions people ask</SectionTitle>
              <div className="space-y-3">
                {s.questions.map((q, i) => (
                  <div key={i}>
                    <p className="text-sm text-mk-text">{q.question}<Cite url={q.source} /></p>
                    <p className="text-xs text-mk-muted mt-0.5">{q.answer_outline}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <SectionTitle icon={Bot}>Showing up in AI answers</SectionTitle>
              <p className="text-sm text-mk-body">{s.ai_visibility.current_state}</p>
              <ul className="mt-3 space-y-2">
                {s.ai_visibility.actions.map((a, i) => <li key={i} className="text-sm"><span className="text-mk-text">{a.action}</span><span className="text-xs text-mk-muted block">{a.why}</span></li>)}
              </ul>
            </Card>
          </div>

          {s.quick_wins.length > 0 && (
            <Card>
              <SectionTitle icon={Zap}>Quick wins this week</SectionTitle>
              <ul className="space-y-1.5">{s.quick_wins.map((w, i) => <li key={i} className="text-sm text-mk-body">• {w}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
