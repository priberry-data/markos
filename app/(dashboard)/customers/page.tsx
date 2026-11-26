import { HeartHandshake } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, PageHeader, SectionTitle, tone } from '@/components/engine/ui'
import { AddCustomers, ConversationBox, CustomerCard, type CustomerView } from '@/components/execs/office-client'
import { getActiveProduct } from '@/lib/products/active'
import type { CustomerSynthesis } from '@/lib/engine/schemas'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: people }, { data: notes }] = await Promise.all([
    supabase.from('customers').select('*').eq('product_id', product.id).order('draft_body', { nullsFirst: false }).order('created_at'),
    supabase.from('customer_notes').select('synthesis, created_at').eq('product_id', product.id).not('synthesis', 'is', null).order('created_at', { ascending: false }).limit(5),
  ])
  const canSend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
  const list = (people ?? []) as CustomerView[]
  return (
    <div className="p-8 max-w-4xl space-y-6">
      <PageHeader icon={HeartHandshake} title="Customers"
        subtitle={`${product.name} · the Customer team drafts the conversations; nothing goes out until you approve it.`} />
      <Card><SectionTitle>A conversation you had</SectionTitle><ConversationBox productId={product.id} customers={list.map(c => ({ id: c.id, name: c.name }))} /></Card>
      {(notes ?? []).length > 0 && (
        <Card>
          <SectionTitle>What customers are saying</SectionTitle>
          <div className="space-y-3">
            {(notes ?? []).map((n, i) => {
              const s = n.synthesis as CustomerSynthesis
              return (
                <div key={i} className={`${tone.inset} px-4 py-3 text-sm`}>
                  <p className="text-mk-body">{s.summary}</p>
                  {s.quotes.map((q, j) => <p key={j} className="text-mk-accent-soft italic mt-1">“{q}”</p>)}
                  {s.bugs.length > 0 && <p className="text-xs text-mk-bad mt-1">Bugs filed: {s.bugs.map(b => b.title).join('; ')}</p>}
                  {s.feature_requests.length > 0 && <p className="text-xs text-mk-muted mt-1">Asked for: {s.feature_requests.join('; ')}</p>}
                </div>
              )
            })}
          </div>
        </Card>
      )}
      <Card>
        <SectionTitle>People ({list.length})</SectionTitle>
        <div className="space-y-2">{list.map(c => <CustomerCard key={c.id} c={c} canSend={canSend} />)}</div>
        <div className="mt-4"><AddCustomers productId={product.id} /></div>
      </Card>
    </div>
  )
}
