'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/** Switch the active product, then open a page for it. */
export function GoToProduct({ productId, href, children, className }: {
  productId: string; href: string; children: React.ReactNode; className?: string
}) {
  const router = useRouter()
  async function go() {
    const res = await fetch(`/api/products/${productId}/activate`, { method: 'POST' })
    if (!res.ok) return toast.error('Could not switch product')
    router.push(href)
    router.refresh()
  }
  return <button onClick={go} className={className}>{children}</button>
}
