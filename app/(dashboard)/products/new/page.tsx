import { Package } from 'lucide-react'
import { PageHeader } from '@/components/engine/ui'
import { ProductForm } from '@/components/engine/product-form'

export default function NewProductPage() {
  return (
    <div className="p-8 max-w-3xl">
      <PageHeader icon={Package} title="Add a product" subtitle="REX starts researching as soon as you save; SAGE then drafts a strategy for your approval." />
      <ProductForm mode="create" initial={{
        name: '', url: '', description: '', category: '', stage: '', target_audience: '', target_geography: '', currency: '',
        ad_budget_monthly: '0', launch_date: '', raising: false, announcing_launch: false, competitors: '', already_tried: '',
        brand_voice: '', primary_color: '', secondary_color: '',
      }} />
    </div>
  )
}
