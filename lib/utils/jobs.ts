// In-process background job runner.
//
// MarkOS runs locally, so there is no serverless execution cap and no need for
// a distributed queue. A job is an async function that outlives the HTTP
// response that started it. Each job gets an AbortSignal, so Stop actually
// stops it: the signal reaches every in-flight AI call.

interface Job {
  promise: Promise<unknown>
  controller: AbortController
}

const running = new Map<string, Job>()

/**
 * Start `fn` in the background, keyed by `id` (normally an agent_runs row id).
 * Returns immediately. If a job with the same id is already in flight, the
 * existing one is returned and `fn` is not started again.
 */
export function startJob(id: string, fn: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
  const existing = running.get(id)
  if (existing) return existing.promise

  const controller = new AbortController()
  const promise = fn(controller.signal)
    .catch(err => {
      // The engine records failure on the run row itself; this is the
      // last-resort net so an unhandled rejection can't take the server down.
      if (!controller.signal.aborted) console.error(`[job ${id}] failed:`, err)
    })
    .finally(() => {
      running.delete(id)
    })

  running.set(id, { promise, controller })
  return promise
}

/** Abort a running job. Returns false if no such job is running. */
export function cancelJob(id: string, reason = 'Cancelled by you'): boolean {
  const job = running.get(id)
  if (!job) return false
  job.controller.abort(new Error(reason))
  return true
}

/** Whether a job with this id is currently in flight in this process. */
export function isJobRunning(id: string): boolean {
  return running.has(id)
}

/** Ids of all in-flight jobs — useful for debugging a stuck run. */
export function runningJobIds(): string[] {
  return [...running.keys()]
}
