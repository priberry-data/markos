import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { agentStatus, currentOutput } from '@/lib/engine/status'
import { CreativeSchema } from '@/lib/engine/schemas'
import { Palette, Image as ImageIcon, Type } from 'lucide-react'
import { PageHeader, Empty, NeedsStrategy, Card, SectionTitle, Pill } from '@/components/engine/ui'
import { AgentMeta } from '@/components/engine/agent-meta'
import { RunAgentButton } from '@/components/engine/run-agent-button'
import { RunWatcher } from '@/components/engine/run-watcher'
import { CopyButton } from '@/components/engine/copy-button'

export const dynamic = 'force-dynamic'

export default async function CreativePage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: brain }, status, output] = await Promise.all([
    supabase.from('product_brains').select('strategy_status').eq('product_id', product.id).maybeSingle(),
    agentStatus(product.id, 'creative'),
    currentOutput(product.id, 'creative'),
  ])
  const parsed = output ? CreativeSchema.safeParse(output.content_json) : null
  const c = parsed?.success ? parsed.data : null

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <RunWatcher productId={product.id} />
      <PageHeader icon={Palette} title="Creative" subtitle={<AgentMeta name="PIXEL" status={status} />}
        actions={brain?.strategy_status === 'approved' && <RunAgentButton productId={product.id} agent="creative" name="PIXEL" running={status.running} />} />
      {brain?.strategy_status !== 'approved' ? <NeedsStrategy /> : !c ? (
        <Empty icon={Palette} title="No visual system yet">PIXEL builds one from your brand colours and the posts NOVA writes.</Empty>
      ) : (
        <>
          <Card>
            <SectionTitle icon={Palette}>Palette</SectionTitle>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {c.palette.map((p, i) => (
                <div key={i} className="bg-mk-bg border border-mk-line rounded-xl overflow-hidden">
                  <div className="h-16" style={{ backgroundColor: /^#[0-9a-f]{3,8}$/i.test(p.hex) ? p.hex : '#1E1E2E' }} />
                  <div className="p-3"><p className="text-sm text-mk-text">{p.name}</p><p className="text-xs text-mk-muted font-mono">{p.hex}</p><p className="text-xs text-mk-muted mt-1">{p.use}</p></div>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid md:grid-cols-2 gap-5">
            <Card><SectionTitle icon={Type}>Typography</SectionTitle><p className="text-sm text-mk-body">{c.typography}</p></Card>
            <Card><SectionTitle icon={ImageIcon}>Image style</SectionTitle><p className="text-sm text-mk-body">{c.image_style}</p></Card>
          </div>
          <Card>
            <SectionTitle icon={ImageIcon}>Image prompts</SectionTitle>
            <p className="text-xs text-mk-muted mb-4">Paste into any image generator (Midjourney, Ideogram, Gemini, FLUX).</p>
            <div className="space-y-3">
              {c.image_prompts.map((p, i) => (
                <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Pill>{p.platform}</Pill><Pill color="violet">{p.aspect_ratio}</Pill>
                    {p.for_content && <span className="text-xs text-mk-muted">for “{p.for_content}”</span>}
                    <div className="ml-auto"><CopyButton text={p.prompt} /></div>
                  </div>
                  <p className="text-sm text-mk-body">{p.prompt}</p>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
