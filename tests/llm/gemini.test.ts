import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gemini } from '@/lib/llm/providers/gemini'
import { ProviderError } from '@/lib/llm/types'

// The Gemini provider is the one piece that talks to the outside world, so it
// can't be covered by the fake provider. Here the network is stubbed and the
// request it builds — and what it makes of the reply — is checked directly.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are inspected loosely
type Call = { url: string; body: any }
let sent: Call[] = []
let replies: Array<{ status: number; json: unknown }> = []

function reply(json: unknown, status = 200) {
  replies.push({ status, json })
}

function ok(text: string, extra: Record<string, unknown> = {}, usage: Record<string, number> = {}) {
  reply({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, ...usage },
  })
}

beforeEach(() => {
  sent = []
  replies = []
  process.env.GEMINI_API_KEY = 'test-key'
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(init.body as string) })
    const next = replies.shift() ?? { status: 200, json: { candidates: [] } }
    return new Response(JSON.stringify(next.json), { status: next.status })
  })
})

afterEach(() => vi.unstubAllGlobals())

const base = { model: 'gemini-3.8-flash', system: 'sys', prompt: 'hi', maxOutputTokens: 1000 }

describe('gemini request', () => {
  it('sends a level, not a token budget, for Gemini 3 — and leaves room for thinking', async () => {
    ok('answer')
    await gemini.call({ ...base, reasoning: 'deep' })
    const { generationConfig } = sent[0].body
    expect(generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'high' })
    // Thinking is billed against maxOutputTokens, so the cap must exceed the ask.
    expect(generationConfig.maxOutputTokens).toBeGreaterThan(1000)
  })

  it('never asks a model for a thinking level it does not support', async () => {
    ok('a'); ok('b')
    await gemini.call({ ...base, model: 'gemini-3.5-flash-lite', reasoning: 'none' })
    await gemini.call({ ...base, model: 'gemini-3.8-flash', reasoning: 'none' })
    expect(sent[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'minimal' })
    // 3.8 Flash has no "minimal", and thinking cannot be switched off at all.
    expect(sent[1].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('still uses a token budget on the legacy 2.5 models', async () => {
    ok('answer')
    await gemini.call({ ...base, model: 'gemini-2.5-flash', reasoning: 'light' })
    expect(sent[0].body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 2048 })
  })

  it('asks for JSON when given a schema, and never searches at the same time', async () => {
    ok('{}')
    await gemini.call({ ...base, jsonSchema: { type: 'object' } })
    expect(sent[0].body.generationConfig.responseMimeType).toBe('application/json')
    expect(sent[0].body.tools).toBeUndefined()
    await expect(gemini.call({ ...base, grounded: true, jsonSchema: { type: 'object' } }))
      .rejects.toThrow(/separate calls/)
  })

  it('retries once with the other spelling if the search tool is rejected', async () => {
    reply({ error: { message: 'Invalid JSON payload received. Unknown name "google_search"' } }, 400)
    ok('found it')
    const res = await gemini.call({ ...base, grounded: true })
    expect(res.text).toBe('found it')
    expect(Object.keys(sent[0].body.tools[0])).toEqual(['google_search'])
    expect(Object.keys(sent[1].body.tools[0])).toEqual(['googleSearch'])
  })

  it('reports a bad key as an auth failure, not an empty result', async () => {
    reply({ error: { message: 'API key not valid' } }, 400)
    await expect(gemini.call(base)).rejects.toMatchObject({ kind: 'auth' })
    reply({ error: { message: 'You exceeded your current quota' } }, 429)
    await expect(gemini.call(base)).rejects.toMatchObject({ kind: 'billing' })
    reply({ error: { message: 'overloaded' } }, 503)
    await expect(gemini.call(base)).rejects.toSatisfy((e: ProviderError) => e.transient)
  })
})

describe('gemini reply', () => {
  it('drops the model’s thinking and counts it as output', async () => {
    reply({
      candidates: [{ content: { parts: [{ text: 'scratch', thought: true }, { text: 'the answer' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30, toolUsePromptTokenCount: 5 },
    })
    const res = await gemini.call(base)
    expect(res.text).toBe('the answer')
    expect(res.usage).toEqual({ inputTokens: 15, outputTokens: 50, groundedRequests: 0 })
  })

  it('marks each sentence with the source it came from', async () => {
    ok('Alpha raised money. Beta did not.', {
      groundingMetadata: {
        webSearchQueries: ['alpha funding'],
        groundingChunks: [{ web: { uri: 'https://one.example', title: 'One' } }, { web: { uri: 'https://two.example', title: 'Two' } }],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 19 }, groundingChunkIndices: [0] },
          { segment: { startIndex: 20, endIndex: 33 }, groundingChunkIndices: [1] },
        ],
      },
    })
    const res = await gemini.call({ ...base, grounded: true })
    expect(res.text).toBe('Alpha raised money.[1] Beta did not.[2]')
    // Marker [n] must line up with sources[n-1].
    expect(res.sources.map(s => s.url)).toEqual(['https://one.example', 'https://two.example'])
    expect(res.usage.groundedRequests).toBe(1)
  })

  it('places markers correctly when the text is not plain ASCII', async () => {
    const text = '“Café” wins.'
    ok(text, {
      groundingMetadata: {
        webSearchQueries: ['café'],
        groundingChunks: [{ web: { uri: 'https://one.example', title: 'One' } }],
        // Byte offsets, not character offsets — the whole point of this test.
        groundingSupports: [{ segment: { startIndex: 0, endIndex: Buffer.byteLength(text, 'utf8') }, groundingChunkIndices: [0] }],
      },
    })
    const res = await gemini.call({ ...base, grounded: true })
    expect(res.text).toBe('“Café” wins.[1]')
  })

  it('says a search that returned nothing was empty, never that nothing exists', async () => {
    reply({ candidates: [] })
    await expect(gemini.call({ ...base, grounded: true })).rejects.toMatchObject({ kind: 'empty' })
    reply({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } })
    await expect(gemini.call(base)).rejects.toThrow(/declined/)
  })

  it('flags a reply that was cut off', async () => {
    reply({ candidates: [{ content: { parts: [{ text: 'half' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {} })
    const res = await gemini.call(base)
    expect(res.truncated).toBe(true)
  })
})
