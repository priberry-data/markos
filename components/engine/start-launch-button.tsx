'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Rocket } from 'lucide-react'

/** Starts a full launch: research → strategy → your approval → production. */
export function StartLaunchButton({ productId, label = 'Start research & strategy' }: { productId: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      const res = await fetch(`/api/products/${productId}/run-agents`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not start')
      toast.success('REX is researching your market')
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button onClick={start} disabled={busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-60">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
      {label}
    </button>
  )
}
