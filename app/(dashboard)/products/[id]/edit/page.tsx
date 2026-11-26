import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { Package } from 'lucide-react'
import { PageHeader } from '@/components/engine/ui'
import { ProductForm } from '@/components/engine/product-form'

export const dynamic = 'force-dynamic'

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: p } = await db().from('products').select('*').eq('id', id).maybeSingle()
  if (!p) notFound()
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return (
    <div className="p-8 max-w-3xl">
      <PageHeader icon={Package} title={p.name} subtitle="Product settings — the agents use all of this." />
      <ProductForm mode="edit" initial={{
        id: p.id, name: s(p.name), url: s(p.url), description: s(p.description), category: s(p.category), stage: s(p.stage),
        target_audience: s(p.target_audience), target_geography: s(p.target_geography), currency: s(p.currency),
        ad_budget_monthly: s(p.ad_budget_monthly ?? 0), launch_date: s(p.launch_date), raising: Boolean(p.raising),
        announcing_launch: Boolean(p.announcing_launch), competitors: s(p.competitors), already_tried: s(p.already_tried),
        brand_voice: s(p.brand_voice), primary_color: s(p.primary_color), secondary_color: s(p.secondary_color),
      }} />
    </div>
  )
}
