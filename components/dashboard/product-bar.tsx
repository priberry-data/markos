'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Inside a product: which product you're in (switch it here), and its
// workspace as tabs. Shown only on product pages.

const TABS: Array<{ href: string; label: string; when?: 'pr' | 'ads' | 'investor' }> = [
  { href: '/approvals', label: 'To approve' },
  { href: '/research', label: 'Research' },
  { href: '/strategy', label: 'Strategy' },
  { href: '/content', label: 'Content' },
  { href: '/distribution', label: 'Distribution' },
  { href: '/search', label: 'Search & AI' },
  { href: '/creative', label: 'Creative' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/customers', label: 'Customers' },
  { href: '/quality', label: 'Quality' },
  { href: '/review', label: 'Weekly review' },
  { href: '/pr', label: 'PR', when: 'pr' },
  { href: '/ads', label: 'Ads', when: 'ads' },
  { href: '/investor', label: 'Fundraising', when: 'investor' },
]
export const PRODUCT_PATHS = TABS.map(t => t.href)

export function ProductBar({ products, currentId, enabled }: {
  products: Array<{ id: string; name: string }>
  currentId: string
  enabled: { pr: boolean; ads: boolean; investor: boolean }
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  if (!PRODUCT_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null

  async function switchTo(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/products/${id}/activate`, { method: 'POST' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sticky top-12 z-20 bg-mk-bg/95 backdrop-blur-sm border-b border-mk-line px-8 pt-3">
      <div className="flex items-center gap-2 mb-2">
        <Link href="/portfolio" className="text-xs text-mk-muted hover:text-mk-text">Products</Link>
        <span className="text-xs text-mk-faint">/</span>
        <div className="relative">
          <select value={currentId} disabled={busy} onChange={e => switchTo(e.target.value)}
            className="appearance-none bg-transparent pr-6 text-sm font-semibold text-mk-text focus:outline-none cursor-pointer">
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-0 top-1 text-mk-muted" /> : <ChevronDown className="w-3.5 h-3.5 absolute right-0 top-1 text-mk-muted pointer-events-none" />}
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto -mb-px">
        {TABS.filter(t => !t.when || enabled[t.when]).map(t => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`)
          return (
            <Link key={t.href} href={t.href}
              className={cn('px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors',
                active ? 'border-mk-accent text-mk-accent font-medium' : 'border-transparent text-mk-muted hover:text-mk-text')}>
              {t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
