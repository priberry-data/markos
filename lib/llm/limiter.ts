// Caps how many AI calls are in flight at once across the whole app. Ten agents
// firing together used to hit provider rate limits, and only one error type was
// ever retried.

export class Limiter {
  private active = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
    if (this.active < this.max) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort)
        this.active++
        resolve()
      }
      const onAbort = () => {
        this.queue = this.queue.filter(g => g !== grant)
        reject(signal?.reason ?? new Error('aborted'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(grant)
    })
  }

  private release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

export const aiLimiter = new Limiter(Number(process.env.MARKOS_MAX_PARALLEL_AI_CALLS ?? 3))
