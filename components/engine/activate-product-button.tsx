'use client'

import { useRouter } from 'next/navigation'

export function ActivateProductButton({ productId }: { productId: string }) {
  const router = useRouter()
  return (
    <button onClick={async () => { await fetch(`/api/products/${productId}/activate`, { method: 'POST' }); router.push('/brief'); router.refresh() }}
      className="px-3 py-2 rounded-lg text-sm text-mk-muted hover:text-mk-text hover:bg-mk-line">
      Switch to
    </button>
  )
}
