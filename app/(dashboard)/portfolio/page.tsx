import { Briefcase } from 'lucide-react'
import { db } from '@/lib/db'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { PageHeader, tone } from '@/components/engine/ui'
import { AutoRefresh } from '@/components/execs/brief-client'
import { PortfolioCard, type PortfolioItem } from '@/components/execs/portfolio-client'

export const dynamic = 'force-dynamic'

export default async function PortfolioPage() {
  const { data } = await db().from('products')
    .select('id, name, url, repo_paths, night_enabled, intake_status, intake').eq('status', 'active').order('created_at')
  const products = (data ?? []) as PortfolioItem[]
  return (
    <div className="p-8 max-w-4xl space-y-5">
      <AutoRefresh active={products.some(p => p.intake_status === 'reading')} />
      <PageHeader icon={Briefcase} title="Products"
        subtitle="Every product your team works on. Open one to see its research, strategy, content, pipeline, customers and quality."
        actions={<Link href="/products/new" className={tone.primaryBtn}><Plus className="w-4 h-4" /> Add a product</Link>} />
      {products.map(p => <PortfolioCard key={p.id} p={p} />)}
    </div>
  )
}
