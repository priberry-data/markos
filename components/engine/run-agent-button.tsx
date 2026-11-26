'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'

/** Run one agent again from the approved strategy. */
export function RunAgentButton({ productId, agent, name, label, running }: {
  productId: string; agent: string; name: string; label?: string; running?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch(`/api/agents/${agent}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Could not start')
      toast.success(`${name} is working on it`)
      router.refresh()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const working = busy || running
  return (
    <button onClick={run} disabled={working}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-text border border-mk-line hover:border-mk-accent disabled:opacity-60">
      {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
      {working ? `${name} is working…` : label ?? `Run ${name} again`}
    </button>
  )
}
