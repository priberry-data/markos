'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `tick` every `ms` while the page is visible, and once right away when it becomes
 * visible again. Nothing runs in a background tab, so an open MarkOS window costs nothing
 * while you work elsewhere.
 */
export function usePoll(tick: () => void | Promise<void>, ms: number) {
  const saved = useRef(tick)
  useEffect(() => { saved.current = tick })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const run = async () => {
      timer = null
      if (stopped || document.visibilityState !== 'visible') return
      try { await saved.current() } catch { /* a missed poll is retried on the next one */ }
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(run, ms)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !timer) void run()
    }
    timer = setTimeout(run, ms)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms])
}
