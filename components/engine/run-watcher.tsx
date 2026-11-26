'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePoll } from '@/lib/utils/use-poll'

/**
 * Re-renders the current page when any run or run step for this product starts, finishes
 * or fails, so pages showing agent output update soon after an agent finishes. It polls a
 * small fingerprint from MarkOS's own API every 3 s while the window is visible.
 */
export function RunWatcher({ productId }: { productId: string }) {
  const router = useRouter()
  const last = useRef<string | null>(null)

  usePoll(async () => {
    const res = await fetch(`/api/pulse?productId=${encodeURIComponent(productId)}`, { cache: 'no-store' })
    if (!res.ok) return
    const { runs } = (await res.json()) as { runs?: string }
    if (!runs) return
    if (last.current !== null && last.current !== runs) router.refresh()
    last.current = runs
  }, 3_000)

  return null
}
