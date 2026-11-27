'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCheck, Loader2 } from 'lucide-react'

/** Approves the drafts on the page, at the versions shown: one that changed or arrived since is left to look at. */
export function BulkApproveButton({ productId, items }: { productId: string; items: Array<{ id: string; version: string }> }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const count = items.length
  return (
    <button disabled={busy || count === 0} onClick={async () => {
      if (!confirm(`Approve all ${count} content drafts? Approving is your OK to publish: X and LinkedIn posts go out at their scheduled times if those accounts are connected. Any with a template gap like [Name] are skipped.`)) return
      setBusy(true)
      const res = await fetch('/api/items/content/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, items }) })
      const body = await res.json().catch(() => ({}))
      setBusy(false)
      if (!res.ok) {
        toast.error(body.error ?? 'Something went wrong')
        if (res.status === 409) router.refresh()   // the page was out of date: show what's there now
        return
      }
      toast.success(`Approved ${body.approved}${body.skipped ? `, skipped ${body.skipped} with gaps` : ''}${body.changed ? `, ${body.changed} changed since the page loaded: look at them again` : ''}`)
      router.refresh()
    }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-mk-text border border-mk-line hover:border-mk-accent disabled:opacity-50">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />} Approve all content
    </button>
  )
}
