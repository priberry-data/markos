import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as SlowFetch from '@/lib/llm/slow-fetch'
import { writeConnections } from '@/lib/llm/connection'
import { ollama } from '@/lib/llm/providers/ollama'
import { openaiCompat } from '@/lib/llm/providers/openai-compat'

// The fetch MarkOS uses for AI servers on this computer or the local network: no limit on how
// long an answer takes, but a short one on connecting, so a computer that's off (or a firewall
// that drops the connection) fails in seconds instead of minutes.

// For the providers below: a name lookup that never answers, so connecting never finishes, and a
// short connect limit so the test doesn't wait 10 seconds. Everything else is the real code. The
// servers are named, never IP addresses: Node skips the lookup for an address and would really
// try to connect to it.
vi.mock('@/lib/llm/slow-fetch', async importOriginal => {
  const real = await importOriginal<typeof SlowFetch>()
  return { ...real, slowFetch: (url: string, init: SlowFetch.SlowInit = {}) => real.slowFetch(url, { ...init, connectTimeoutMs: 150, lookup: () => {} }) }
})

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-slow-'))
const previousHome = process.env.MARKOS_HOME
let real: typeof SlowFetch
let port = 0
let closedPort = 0
const server = http.createServer((_req, res) => {
  // Answers after longer than the connect limit used below: only connecting is timed.
  setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') }, 400)
})

beforeAll(async () => {
  process.env.MARKOS_HOME = home
  real = await vi.importActual<typeof SlowFetch>('@/lib/llm/slow-fetch')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  const probe = http.createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  closedPort = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
  if (previousHome === undefined) delete process.env.MARKOS_HOME
  else process.env.MARKOS_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('slowFetch', () => {
  it('gives up connecting after the connect limit, and says that’s what happened', async () => {
    const started = Date.now()
    const err = await real.slowFetch('http://never-answers.test:9/', { connectTimeoutMs: 150, lookup: () => {} }).catch(e => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(real.connectTimedOut(err)).toBe(true)
    expect(real.connectionRefused(err)).toBe(false)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('waits for an answer as long as it takes once connected', async () => {
    const res = await real.slowFetch(`http://127.0.0.1:${port}/`, { connectTimeoutMs: 100 })
    expect(await res.json()).toEqual({ ok: true })
  })

  it('tells a refused connection from one nobody answered', async () => {
    const err = await real.slowFetch(`http://127.0.0.1:${closedPort}/`).catch(e => e)
    expect(real.connectionRefused(err)).toBe(true)
    expect(real.connectTimedOut(err)).toBe(false)
  })
})

describe('an AI server on the local network that never answers', () => {
  it('Ollama: says so at once and isn’t retried, instead of waiting minutes per try', async () => {
    writeConnections({ ollama: { baseUrl: 'http://ai-box.test:11434' } })
    const err = await ollama.call({ model: 'qwen3:8b', system: 's', prompt: 'p', maxOutputTokens: 100 }).catch(e => e)
    expect(err.kind).toBe('not_configured') // not transient, so the AI layer doesn't try again
    expect(err.message).toMatch(/Nothing answered at http:\/\/ai-box\.test:11434.*firewall/)
  })

  it('an OpenAI-compatible server (LM Studio): the same', async () => {
    writeConnections({ compat: { preset: 'lmstudio', baseUrl: 'http://ai-box.localhost:1234/v1' } })
    const err = await openaiCompat.call({ model: 'm', system: 's', prompt: 'p', maxOutputTokens: 100 }).catch(e => e)
    expect(err.kind).toBe('not_configured')
    expect(err.message).toMatch(/Nothing answered at http:\/\/ai-box\.localhost:1234\/v1\. Check that LM Studio is running.*firewall/)
  })

  it('names no server for “any other OpenAI-compatible API”', async () => {
    writeConnections({ compat: { preset: 'custom', baseUrl: 'http://ai-box.localhost:8000/v1' } })
    const err = await openaiCompat.call({ model: 'm', system: 's', prompt: 'p', maxOutputTokens: 100 }).catch(e => e)
    expect(err.message).toMatch(/Check that your AI server is running on that computer/)
  })
})
