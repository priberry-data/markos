import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeConnections } from '@/lib/llm/connection'
import { anthropic } from '@/lib/llm/providers/anthropic'

// What MarkOS asks the Anthropic API for: never a tool that runs on this computer. A web
// search, when one is wanted, is Anthropic's own search, run on its servers. The network is
// stubbed: each request is recorded and refused, which is all this needs.

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-anthropic-'))
const saved = { home: process.env.MARKOS_HOME, key: process.env.ANTHROPIC_API_KEY }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are inspected loosely
let bodies: any[] = []

beforeEach(() => {
  process.env.MARKOS_HOME = home
  delete process.env.ANTHROPIC_API_KEY
  bodies = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? await input.text() : String(init?.body ?? '')
    bodies.push(raw ? JSON.parse(raw) : null)
    return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'recorded' } }), {
      status: 400, headers: { 'content-type': 'application/json' },
    })
  })
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => {
  if (saved.home === undefined) delete process.env.MARKOS_HOME
  else process.env.MARKOS_HOME = saved.home
  if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key
  fs.rmSync(home, { recursive: true, force: true })
})

describe('the Anthropic API', () => {
  it('gets no tools for writing, and only Anthropic’s own web search when searching', async () => {
    writeConnections({ anthropicKey: 'sk-ant-test-tools-123456' })
    const req = { model: 'claude-sonnet-5', system: 's', prompt: 'p', maxOutputTokens: 100 }
    await expect(anthropic.call(req)).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(anthropic.call({ ...req, jsonSchema: { type: 'object' } })).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(anthropic.call({ ...req, grounded: true })).rejects.toMatchObject({ kind: 'bad_request' })
    expect(bodies).toHaveLength(3)
    expect(bodies[0].tools).toBeUndefined()
    expect(bodies[1].tools).toBeUndefined()
    expect(bodies[2].tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }])
  })
})
