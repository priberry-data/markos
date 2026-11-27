import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'

// A fetch for AI servers on this computer or the local network (Ollama, LM Studio, llama.cpp...).
//
// Node's built-in fetch gives up when a server sends no reply headers for 300 seconds, and a
// model on a laptop can take longer than that to read a long prompt before it says anything.
// This one waits as long as the caller's signal allows once connected; only connecting has a
// limit (10 seconds, as Node's fetch has), so a computer that never answers fails fast.
// Failures take fetch's shape (a TypeError "fetch failed" with the cause attached, or the
// signal's reason when cancelled), so callers handle both the same way.

const NO_BODY = new Set([204, 205, 304])
const CONNECT_TIMEOUT_MS = 10_000
/** The cause's code when nothing answered the connection in time (not an OS code, so never confused with one). */
const CONNECT_TIMEOUT = 'MARKOS_CONNECT_TIMEOUT'

export interface SlowInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
  /** How long connecting may take (10 seconds unless set). */
  connectTimeoutMs?: number
  /** Resolves the host name (Node's own lookup unless set). */
  lookup?: LookupFunction
}

function causeOf(err: unknown) {
  return ((err as { cause?: unknown } | null)?.cause ?? err) as { code?: string; errors?: Array<{ code?: string }> } | null
}

/**
 * Nothing is listening at that address: the only failure that means a server isn't running.
 * (Node may try IPv6 and IPv4 for one name and report both refusals together.)
 */
export function connectionRefused(err: unknown): boolean {
  const cause = causeOf(err)
  return cause?.code === 'ECONNREFUSED' || Boolean(cause?.errors?.some(e => e?.code === 'ECONNREFUSED'))
}

/** Nothing answered the connection at all in time: that computer is off, or a firewall drops it. */
export function connectTimedOut(err: unknown): boolean {
  return causeOf(err)?.code === CONNECT_TIMEOUT
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

export function slowFetch(url: string, init: SlowInit = {}): Promise<Response> {
  const target = new URL(url)
  const client = target.protocol === 'https:' ? https : http
  const { signal } = init
  const connectMs = init.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal))
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const fail = (cause: unknown) => finish(() => reject(Object.assign(new TypeError('fetch failed'), { cause })))

    const headers: Record<string, string | number> = { ...init.headers }
    if (init.body !== undefined) headers['Content-Length'] = Buffer.byteLength(init.body)
    const options: http.RequestOptions = { method: init.method ?? 'GET', headers }
    if (init.lookup) options.lookup = init.lookup
    const req = client.request(target, options, res => {
      const chunks: Buffer[] = []
      let ended = false
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        ended = true
        const status = res.statusCode ?? 502
        const out = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const one of v) out.append(k, one)
          else if (v !== undefined) out.set(k, v)
        }
        finish(() => resolve(new Response(NO_BODY.has(status) ? null : Buffer.concat(chunks), {
          status, statusText: res.statusMessage ?? '', headers: out,
        })))
      })
      res.on('error', fail)
      res.on('close', () => { if (!ended) fail(new Error('The connection closed before the answer finished.')) })
    })
    // Only connecting is timed (a reused connection is already open); the answer may take as long as it needs.
    req.on('socket', socket => {
      if (!socket.connecting) return
      const timer = setTimeout(() => {
        req.destroy(Object.assign(new Error(`Nothing answered within ${Math.round(connectMs / 1000)} seconds.`), { code: CONNECT_TIMEOUT }))
      }, connectMs)
      socket.once('connect', () => clearTimeout(timer))
      socket.once('close', () => clearTimeout(timer))
    })
    function onAbort() {
      finish(() => reject(abortReason(signal!)))
      req.destroy()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('error', fail)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}
