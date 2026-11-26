import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/dashboard/sidebar'
import { ProductBar } from '@/components/dashboard/product-bar'
import { NotificationBell } from '@/components/dashboard/notification-bell'
import { ThemeToggle } from '@/components/theme'
import { inboxItems } from '@/lib/engine/execs/inbox'

// Every page shows live data (products, approvals, notifications): never pre-render.
export const dynamic = 'force-dynamic'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = db()
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999)

  const [{ data: profile }, { data: products }, { data: notifications }, inbox, { count: meetingsToday }] = await Promise.all([
    supabase.from('profiles').select('active_product_id').eq('id', 1).single(),
    supabase.from('products').select('id, name, status, announcing_launch, raising, ad_budget_monthly').eq('status', 'active').order('created_at'),
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30),
    inboxItems(),
    supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString()).lte('scheduled_at', dayEnd.toISOString()),
  ])

  // No login and no separate onboarding gate: with no products yet, the only
  // useful screen is the first-product wizard.
  if (!products || products.length === 0) redirect('/onboarding')

  const active = products.find(p => p.id === profile?.active_product_id) ?? products[0]

  return (
    <div className="min-h-screen bg-mk-bg flex">
      <Sidebar inbox={inbox.reduce((n, i) => n + i.count, 0)} meetingsToday={meetingsToday ?? 0} />
      <main className="flex-1 ml-60 min-h-screen">
        <div className="fixed top-0 right-0 left-60 h-12 bg-mk-bg/80 backdrop-blur-sm border-b border-mk-line flex items-center justify-end gap-1 px-6 z-30">
          <ThemeToggle />
          <NotificationBell
            initialNotifications={(notifications ?? []) as Parameters<typeof NotificationBell>[0]['initialNotifications']}
          />
        </div>
        <div className="pt-12">
          <ProductBar
            products={products.map(p => ({ id: p.id as string, name: p.name as string }))}
            currentId={active.id as string}
            enabled={{ pr: Boolean(active.announcing_launch), ads: Number(active.ad_budget_monthly ?? 0) > 0, investor: Boolean(active.raising) }}
          />
          {children}
        </div>
      </main>
    </div>
  )
}
