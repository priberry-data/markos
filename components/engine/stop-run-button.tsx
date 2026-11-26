'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Square } from 'lucide-react'

export function StopRunButton({ productId }: { productId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button disabled={busy} onClick={async () => {
      setBusy(true)
      const res = await fetch(`/api/products/${productId}/stop-agents`, { method: 'POST' })
      setBusy(false)
      if (res.ok) { toast.success('Stopped'); router.refresh() } else toast.error((await res.json()).error ?? 'Could not stop')
    }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-mk-bad border border-mk-bad/30 hover:bg-mk-bad/10 disabled:opacity-50">
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />} Stop
    </button>
  )
}
