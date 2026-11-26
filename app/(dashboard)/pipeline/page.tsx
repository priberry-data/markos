import { Handshake } from 'lucide-react'
import { db } from '@/lib/db'
import { Empty, PageHeader } from '@/components/engine/ui'
import { PipelineCard, type PipelineRow } from '@/components/execs/pipeline-client'
import { getActiveProduct } from '@/lib/products/active'

export const dynamic = 'force-dynamic'

const ORDER = ['meeting', 'replied', 'contacted', 'identified', 'won', 'lost', 'dropped']

export default async function PipelinePage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const { data } = await supabase.from('pipeline').select('*').eq('product_id', product.id).order('updated_at', { ascending: false })
  const rows = ((data ?? []) as PipelineRow[]).sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage))
  const canSend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
  return (
    <div className="p-8 max-w-4xl space-y-3">
      <PageHeader icon={Handshake} title="Pipeline" subtitle={`${product.name} · organisations the Sales exec found, each from a real page. Pitches go out only when you send them.`} />
      {rows.length === 0
        ? <Empty icon={Handshake} title="No prospects yet">The Sales exec adds them during the night shift, or ask: “find design partners for …”.</Empty>
        : rows.map(r => <PipelineCard key={r.id} r={r} canSend={canSend} />)}
    </div>
  )
}
