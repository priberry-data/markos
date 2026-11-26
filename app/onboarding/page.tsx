import { redirect } from 'next/navigation'
import { Zap } from 'lucide-react'
import { db } from '@/lib/db'
import { ProductForm } from '@/components/engine/product-form'

export const dynamic = 'force-dynamic'

/** First run: add a product. REX starts researching as soon as it's saved. */
export default async function OnboardingPage() {
  const { count } = await db().from('products').select('id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) redirect('/brief')

  return (
    <div className="min-h-screen bg-mk-bg py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-mk-accent flex items-center justify-center"><Zap className="w-4 h-4 text-white" /></div>
          <h1 className="text-2xl font-bold text-mk-text">Welcome to MarkOS</h1>
        </div>
        <p className="text-mk-muted mb-8">
          Tell the team about your product. REX researches your market on the live web, SAGE drafts a strategy for you to approve,
          then the rest of the team writes from it.
        </p>
        <ProductForm mode="create" initial={{
          name: '', url: '', description: '', category: '', stage: '', target_audience: '', target_geography: '', currency: '',
          ad_budget_monthly: '0', launch_date: '', raising: false, announcing_launch: false, competitors: '', already_tried: '',
          brand_voice: '', primary_color: '', secondary_color: '',
        }} />
      </div>
    </div>
  )
}
