import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeConnections, readConnections, compatConnection, cleanBaseUrl } from '@/lib/llm/connection'
import { isLocalUrl, isNearbyUrl } from '@/lib/llm/presets'
import { openaiCompat, stripThinking } from '@/lib/llm/providers/openai-compat'
import { contextFor, ollama, sizeFor } from '@/lib/llm/providers/ollama'
import { ProviderError } from '@/lib/llm/types'

// The OpenAI-compatible and Ollama providers talk to servers MarkOS doesn't
// control, so both the request each builds and what it makes of the reply are
// checked directly — including how it adapts when a server rejects a parameter.
// Hosted APIs are stubbed at fetch. A server on this computer is a real one on
// 127.0.0.1, because MarkOS talks to those without Node's fetch (which gives up
// after 300 seconds, sooner than a laptop model may take to answer).

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are inspected loosely
type Call = { url: string; body: any; headers: Record<string, string> }
let sent: Call[] = []
let replies: Array<{ status: number; json: unknown } | Error> = []

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-ai-'))
const previousHome = process.env.MARKOS_HOME

beforeEach(() => {
  process.env.MARKOS_HOME = home
  sent = []
  replies = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), body: init.body ? JSON.parse(init.body as string) : null, headers: (init.headers ?? {}) as Record<string, string> })
    const next = replies.shift() ?? { status: 500, json: { error: { message: 'no reply queued' } } }
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.json), { status: next.status })
  })
})

afterEach(() => vi.unstubAllGlobals())
afterAll(() => {
  if (previousHome === undefined) delete process.env.MARKOS_HOME
  else process.env.MARKOS_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

// ── a model server on this computer ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are inspected loosely
type Seen = { path: string; body: any; headers: http.IncomingHttpHeaders }
let seen: Seen[] = []
let queue: Array<{ status: number; json: unknown } | 'drop'> = []
let show: { status: number; json: unknown } = { status: 200, json: { model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } } }
const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    seen.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null, headers: req.headers })
    const next = req.url === '/api/show' ? show : queue.shift() ?? { status: 500, json: { error: 'no reply queued' } }
    if (next === 'drop') return void req.socket.destroy()
    res.writeHead(next.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(next.json))
  })
})
let port = 0
let closedPort = 0
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  // A port nothing listens on: the "not running" case.
  const probe = http.createServer()
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
  closedPort = (probe.address() as AddressInfo).port
  await new Promise<void>(resolve => probe.close(() => resolve()))
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})
/** In the blocks for servers on this computer: prove nothing goes through Node's fetch. */
const noGlobalFetch = () => vi.stubGlobal('fetch', async () => { throw new Error('a model on this computer must not go through Node’s fetch') })

const answer = (content: string, extra: Record<string, unknown> = {}, usage: Record<string, number> = {}) =>
  ({ status: 200, json: { choices: [{ message: { content, ...extra }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7, ...usage } } })
const rejected = (message: string) => ({ status: 400, json: { error: { message } } })

const base = { model: 'm-1', system: 'sys', prompt: 'hi', maxOutputTokens: 1000 }
const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }

describe('the saved connection', () => {
  it('is written to MarkOS’s own folder, readable only by the owner', () => {
    writeConnections({ compat: { preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-123456' } })
    const file = path.join(home, 'ai.json')
    expect(fs.existsSync(file)).toBe(true)
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o077).toBe(0)
    expect(readConnections().compat?.apiKey).toBe('sk-test-123456')
  })

  it('needs a key for a hosted AI, but not for one on this computer', () => {
    writeConnections({ compat: { preset: 'groq', baseUrl: 'https://api.groq.com/openai/v1' } })
    expect(compatConnection()).toBeNull()
    writeConnections({ compat: { preset: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1' } })
    expect(compatConnection()?.baseUrl).toBe('http://127.0.0.1:1234/v1')
  })

  it('accepts https anywhere and plain http only on this computer or a private network', () => {
    expect(cleanBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1')
    expect(cleanBaseUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
    expect(cleanBaseUrl('http://192.168.1.20:8000/v1')).toBe('http://192.168.1.20:8000/v1')
    expect(cleanBaseUrl('http://example.com/v1')).toBeNull()
    // Only real IP literals count as this computer or a private network.
    expect(cleanBaseUrl('http://10.evil.com/v1')).toBeNull()
    expect(cleanBaseUrl('http://127.evil.com/v1')).toBeNull()
    expect(cleanBaseUrl('http://10.0.0.5:8000/v1')).toBe('http://10.0.0.5:8000/v1')
    expect(isLocalUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(isLocalUrl('http://127.evil.com/v1')).toBe(false)
    // A model on another machine at home counts as nearby: no bill, one call at a time, slow to answer.
    expect(isNearbyUrl('http://192.168.1.20:1234/v1')).toBe(true)
    expect(isNearbyUrl('http://10.0.0.5:8000/v1')).toBe(true)
    expect(isNearbyUrl('http://localhost:1234/v1')).toBe(true)
    expect(isNearbyUrl('https://api.groq.com/openai/v1')).toBe(false)
    expect(isNearbyUrl('http://10.evil.com/v1')).toBe(false)
    expect(cleanBaseUrl('https://user:pass@example.com/v1')).toBeNull()
    expect(cleanBaseUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('OpenAI-compatible request', () => {
  beforeEach(() => writeConnections({ compat: { preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-123456' } }))

  it('sends the key, the messages and the right length parameter', async () => {
    replies.push(answer('hello'))
    const res = await openaiCompat.call(base)
    expect(res.text).toBe('hello')
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 7, groundedRequests: 0 })
    const call = sent[0]
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(call.headers.Authorization).toBe('Bearer sk-test-123456')
    expect(call.body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }])
    expect(call.body.max_completion_tokens).toBeGreaterThanOrEqual(1000)
    expect(call.body.max_tokens).toBeUndefined()
    expect(call.body.tools).toBeUndefined()
  })

  it('switches the length parameter and drops temperature when the server refuses them, and remembers', async () => {
    replies.push(rejected("Unsupported parameter: 'max_completion_tokens'"), rejected("Unsupported value: 'temperature' does not support 0.7"), answer('ok'))
    await openaiCompat.call({ ...base, model: 'm-adapt' })
    expect(sent).toHaveLength(3)
    expect(sent[2].body.max_tokens).toBeGreaterThanOrEqual(1000)
    expect(sent[2].body.temperature).toBeUndefined()
    replies.push(answer('again'))
    await openaiCompat.call({ ...base, model: 'm-adapt' })
    expect(sent).toHaveLength(4)
    expect(sent[3].body.max_tokens).toBeDefined()
    expect(sent[3].body.temperature).toBeUndefined()
  })

  it('drops the thinking room when a small model’s context window can’t fit it', async () => {
    replies.push(rejected("This model's maximum context length is 8192 tokens. However, you requested 13288 tokens."), answer('fits'))
    const res = await openaiCompat.call({ ...base, model: 'm-small', reasoning: 'deep' })
    expect(res.text).toBe('fits')
    expect(sent[0].body.max_completion_tokens).toBe(1000 + 12288)
    expect(sent[1].body.max_completion_tokens).toBe(1000)
  })

  it('when the length is too large: drops the thinking room, then clamps to the limit the server names, and remembers', async () => {
    replies.push(
      rejected('max_completion_tokens is too large: 9216. This model supports at most 4096 completion tokens, whereas you provided 9216.'),
      rejected('max_completion_tokens is too large: 8192. This model supports at most 4096 completion tokens, whereas you provided 8192.'),
      answer('clamped'),
    )
    const res = await openaiCompat.call({ ...base, model: 'm-cap', maxOutputTokens: 8192 })
    expect(res.text).toBe('clamped')
    expect(sent.map(c => c.body.max_completion_tokens)).toEqual([8192 + 1024, 8192, 4096])
    expect(sent.every(c => c.body.max_tokens === undefined)).toBe(true) // never mistaken for the wrong parameter name
    replies.push(answer('again'))
    await openaiCompat.call({ ...base, model: 'm-cap', maxOutputTokens: 8192 })
    expect(sent[3].body.max_completion_tokens).toBe(4096)
  })

  it('fits the answer beside a long prompt for this request only, and never takes the prompt’s size as the model’s limit', async () => {
    const overflow = (asked: number) =>
      rejected(`This model's maximum context length is 32768 tokens. However, you requested ${30000 + asked} tokens (30000 in the messages, ${asked} in the completion). Please reduce the length of the messages or completion.`)
    replies.push(overflow(8192 + 12288), answer('fits'))
    const res = await openaiCompat.call({ ...base, model: 'm-window', maxOutputTokens: 8192, reasoning: 'deep' })
    expect(res.text).toBe('fits')
    expect(sent.map(c => c.body.max_completion_tokens)).toEqual([8192 + 12288, 32768 - 30000 - 64])
    // A shorter prompt next time gets the full length and the thinking room again: 30,000 tokens
    // was that prompt, not the model.
    replies.push(answer('again'))
    await openaiCompat.call({ ...base, model: 'm-window', maxOutputTokens: 8192, reasoning: 'deep' })
    expect(sent[2].body.max_completion_tokens).toBe(8192 + 12288)
  })

  it('reads vLLM’s wording of the same overflow, and never takes the prompt’s size as an answer limit', async () => {
    const vllm = (asked: number) =>
      rejected(`'max_tokens' or 'max_completion_tokens' is too large: ${asked}. This model's maximum context length is 8192 tokens and your request has 3000 input tokens (${asked} > 8192 - 3000).`)
    replies.push(vllm(8192 + 1024), answer('fits'))
    await openaiCompat.call({ ...base, model: 'm-vllm', maxOutputTokens: 8192 })
    expect(sent.map(c => c.body.max_completion_tokens)).toEqual([8192 + 1024, 8192 - 3000 - 64])
    // Nothing was remembered: no cap of 3,000 (the prompt's size), and the thinking room stays.
    replies.push(answer('again'))
    await openaiCompat.call({ ...base, model: 'm-vllm', maxOutputTokens: 8192 })
    expect(sent[2].body.max_completion_tokens).toBe(8192 + 1024)
  })

  it('says clearly, after one request, when a prompt leaves no room for an answer', async () => {
    replies.push(rejected("This model's maximum context length is 8192 tokens. However, you requested 17400 tokens (9208 in the messages, 8192 in the completion)."))
    const err = await openaiCompat.call({ ...base, model: 'm-full', maxOutputTokens: 7168 }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/about 9,208 tokens long.*m-full can take at once \(8,192\)/)
    expect(sent).toHaveLength(1)
  })

  it('remembers an adaptation only once a request succeeds with it', async () => {
    replies.push(rejected("Unsupported value: 'temperature' does not support 0.7"), rejected('Something else is wrong with this request'))
    await expect(openaiCompat.call({ ...base, model: 'm-unsure' })).rejects.toMatchObject({ kind: 'bad_request' })
    replies.push(answer('ok'))
    await openaiCompat.call({ ...base, model: 'm-unsure' })
    expect(sent[2].body.temperature).toBeDefined()
  })

  it('asks for the schema, then falls back to JSON mode, then to the schema in the instructions', async () => {
    replies.push(rejected('response_format json_schema is not supported'), rejected('response_format type json_object is not supported'), answer('{"a":"x"}'))
    const res = await openaiCompat.call({ ...base, model: 'm-json', jsonSchema: schema })
    expect(res.text).toBe('{"a":"x"}')
    expect(sent[0].body.response_format.type).toBe('json_schema')
    expect(sent[0].body.response_format.json_schema.schema).toEqual(schema)
    expect(sent[1].body.response_format).toEqual({ type: 'json_object' })
    expect(sent[2].body.response_format).toBeUndefined()
    expect(sent[2].body.messages[0].content).toContain(JSON.stringify(schema))
  })

  it('strips a reasoning model’s visible thinking', async () => {
    replies.push(answer('<think>let me see</think>\nThe answer.'))
    expect((await openaiCompat.call(base)).text).toBe('The answer.')
    expect(stripThinking('reasoning…</think>Done')).toBe('Done')
  })

  it('marks a reply cut off by the length limit', async () => {
    replies.push({ status: 200, json: { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] } })
    expect((await openaiCompat.call(base)).truncated).toBe(true)
  })

  it('classifies a bad key, no credit and a missing model', async () => {
    replies.push({ status: 401, json: { error: { message: 'Incorrect API key' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'auth' })
    replies.push({ status: 429, json: { error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'billing' })
    replies.push({ status: 429, json: { error: { message: 'Rate limit reached for requests' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'rate_limit' })
    replies.push({ status: 402, json: { error: { message: 'Insufficient credits' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'billing' })
    replies.push({ status: 404, json: { error: { message: 'The model `nope` does not exist', code: 'model_not_found' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'bad_request' })
  })

  it('tells a refused prompt from a bad key, and a slow server from a bad request', async () => {
    replies.push({ status: 403, json: { error: { message: 'Your input was flagged by our moderation system.' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'bad_request' })
    replies.push({ status: 403, json: { error: { message: 'Invalid API key provided' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'auth' })
    replies.push({ status: 408, json: { error: { message: 'Request timeout' } } })
    await expect(openaiCompat.call(base)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('refuses a web search on an AI that can’t search, rather than letting it guess', async () => {
    await expect(openaiCompat.call({ ...base, grounded: true })).rejects.toBeInstanceOf(ProviderError)
    expect(sent).toHaveLength(0)
  })
})

describe('OpenRouter', () => {
  beforeEach(() => writeConnections({ compat: { preset: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-test-123' } }))

  it('searches through the web plugin, returns its citations and records the cost it reports', async () => {
    replies.push(answer('Today is Friday [1].', {
      annotations: [
        { type: 'url_citation', url_citation: { url: 'https://news.test/a', title: 'A headline', content: 'Body of A' } },
        { type: 'url_citation', url_citation: { url: 'https://news.test/a', title: 'dupe' } },
      ],
    }, { cost: 0.0123 }))
    const res = await openaiCompat.call({ ...base, model: 'openai/gpt-5.2', grounded: true })
    expect(sent[0].body.plugins).toEqual([{ id: 'web', max_results: 5 }])
    expect(sent[0].body.tools).toBeUndefined() // a search runs on OpenRouter's servers, never a tool here
    expect(res.sources).toEqual([{ title: 'A headline', url: 'https://news.test/a' }])
    expect(res.usage.groundedRequests).toBe(1)
    expect(res.costUsd).toBe(0.0123)
    expect(res.evidence).toContain('Body of A')
  })

  it('reads OpenRouter’s wording of a prompt too long for the room asked, and fits the answer beside it', async () => {
    // OpenRouter's own words, the prompt split into its parts.
    const overflow = (asked: number) =>
      rejected(`This endpoint's maximum context length is 32768 tokens. However, you requested about ${14000 + asked} tokens (13000 of text input, 1000 of tool input, ${asked} in the output). Please reduce the length of either one, or use the "middle-out" transform to compress your prompt automatically.`)
    replies.push(overflow(8192 + 12288), answer('fits'))
    const res = await openaiCompat.call({ ...base, model: 'qwen/qwen3-32b', maxOutputTokens: 8192, reasoning: 'deep' })
    expect(res.text).toBe('fits')
    expect(sent.map(c => c.body.max_completion_tokens)).toEqual([8192 + 12288, 32768 - 14000 - 64])
    // Nothing remembered: a shorter prompt next time gets the full length and the thinking room.
    replies.push(answer('again'))
    await openaiCompat.call({ ...base, model: 'qwen/qwen3-32b', maxOutputTokens: 8192, reasoning: 'deep' })
    expect(sent[2].body.max_completion_tokens).toBe(8192 + 12288)
  })
})

describe('a server on this computer', () => {
  beforeEach(() => {
    noGlobalFetch()
    seen = []
    queue = []
    writeConnections({ compat: { preset: 'lmstudio', baseUrl: `http://127.0.0.1:${port}/v1` } })
  })

  it('sends no key, costs nothing, and goes around Node’s fetch', async () => {
    queue.push(answer('local'))
    const res = await openaiCompat.call(base)
    expect(res.text).toBe('local')
    expect(seen[0].path).toBe('/v1/chat/completions')
    expect(seen[0].headers.authorization).toBeUndefined()
    expect(res.costUsd).toBe(0)
  })

  it('says to start the server only when nothing is listening', async () => {
    writeConnections({ compat: { preset: 'lmstudio', baseUrl: `http://127.0.0.1:${closedPort}/v1` } })
    const err = await openaiCompat.call(base).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('not_configured') // not retried: nothing is listening
    expect(err.message).toMatch(/Start LM Studio/)
  })

  it('calls a dropped connection a network failure, which is retried, not a server that isn’t running', async () => {
    queue.push('drop')
    const err = await openaiCompat.call(base).catch(e => e)
    expect(err.kind).toBe('network')
    expect(err.transient).toBe(true)
  })
})

describe('Ollama', () => {
  beforeEach(() => {
    noGlobalFetch()
    seen = []
    queue = []
    show = { status: 200, json: { model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } } }
    writeConnections({ ollama: { baseUrl: `http://127.0.0.1:${port}` } })
  })
  const chats = () => seen.filter(c => c.path === '/api/chat')

  it('uses the native API with a window that fits the whole prompt and the answer, and no tools', async () => {
    queue.push({ status: 200, json: { message: { content: '{"a":"x"}' }, done_reason: 'stop', prompt_eval_count: 900, eval_count: 40 } })
    const prompt = 'x'.repeat(60_000)
    const res = await ollama.call({ ...base, model: 'qwen3:8b', prompt, jsonSchema: schema })
    const chat = chats()[0]
    expect(chat.body.stream).toBe(false)
    expect(chat.body.format).toEqual(schema)
    expect(chat.body.tools).toBeUndefined()
    // The answer's length is part of the window, so Ollama never drops the prompt's start to make room.
    expect(chat.body.options.num_ctx).toBeGreaterThanOrEqual(Math.ceil(60_000 / 3) + chat.body.options.num_predict)
    expect(chat.body.options.num_predict).toBeGreaterThanOrEqual(1000)
    // And if the estimate is ever short, Ollama fails instead of cutting or sliding the context.
    expect(chat.body.truncate).toBe(false)
    expect(chat.body.shift).toBe(false)
    expect(res.text).toBe('{"a":"x"}')
    expect(res.usage).toEqual({ inputTokens: 900, outputTokens: 40, groundedRequests: 0 })
    expect(res.costUsd).toBe(0)
  })

  it('makes room for a reasoning model to think, inside the window', async () => {
    queue.push({ status: 200, json: { message: { content: 'ok' }, done_reason: 'stop' } })
    const prompt = 'y'.repeat(30_000)
    await ollama.call({ ...base, model: 'qwen3:8b', prompt, maxOutputTokens: 4000, reasoning: 'deep' })
    const { num_ctx, num_predict } = chats()[0].body.options
    expect(num_predict).toBe(4000 + 8192)
    expect(num_ctx).toBeGreaterThanOrEqual(Math.ceil(30_000 / 3) + num_predict)
  })

  it('refuses a prompt longer than the model was trained for, which Ollama would quietly cut', async () => {
    show = { status: 200, json: { model_info: { 'general.architecture': 'tiny', 'tiny.context_length': 4096 } } }
    const err = await ollama.call({ ...base, model: 'tiny:1b', prompt: 'x'.repeat(30_000) }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/tiny:1b can take at once \(4,096\)/)
    expect(chats()).toHaveLength(0)
  })

  it('refuses a prompt too long for any local window without asking Ollama anything', async () => {
    const err = await ollama.call({ ...base, model: 'qwen3:8b', prompt: 'x'.repeat(400_000) }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/tokens/)
    expect(seen).toHaveLength(0)
  })

  it('keeps small prompts at a modest window, caps huge ones, and fits the answer inside', () => {
    expect(contextFor({ system: 's', prompt: 'p', maxOutputTokens: 1000 })).toBe(8192)
    expect(contextFor({ system: 's', prompt: 'p'.repeat(1_000_000), maxOutputTokens: 1000 })).toBe(65536)
    // The thinking room shrinks before the answer does; when the answer can't fit, no size at all.
    const tight = sizeFor({ system: 's', prompt: 'p'.repeat(9000), maxOutputTokens: 500 }, 4096)!
    expect(tight.numCtx).toBe(4096)
    expect(tight.numPredict).toBeGreaterThanOrEqual(500)
    expect(Math.ceil(9001 / 3) + tight.numPredict).toBeLessThanOrEqual(4096)
    expect(sizeFor({ system: 's', prompt: 'p'.repeat(12_000), maxOutputTokens: 1000 }, 4096)).toBeNull()
  })

  it('gives the answer what the prompt leaves when the model’s window is smaller than the answer could be', async () => {
    // An 8,192-token model and a step that allows an 8,192-token answer: most answers are far
    // shorter, so the step runs with what's left rather than being refused.
    const small = sizeFor({ system: 's', prompt: 'p'.repeat(300), maxOutputTokens: 8192 }, 8192)!
    expect(small.numCtx).toBe(8192)
    expect(small.numPredict).toBe(8192 - (Math.ceil(301 / 3) + 256))
    // Refused only when the prompt leaves less than a short answer.
    expect(sizeFor({ system: 's', prompt: 'p'.repeat(22_000), maxOutputTokens: 8192 }, 8192)).toBeNull()
    show = { status: 200, json: { model_info: { 'general.architecture': 'gemma2', 'gemma2.context_length': 8192 } } }
    queue.push({ status: 200, json: { message: { content: 'short answer' }, done_reason: 'stop' } })
    const res = await ollama.call({ ...base, model: 'gemma2:9b', prompt: 'p'.repeat(3000), maxOutputTokens: 8192 })
    expect(res.text).toBe('short answer')
    const { num_ctx, num_predict } = chats()[0].body.options
    expect(num_ctx).toBe(8192)
    expect(num_predict).toBe(8192 - (Math.ceil(3003 / 3) + 256))
  })

  it('says plainly when the window left too little room for the answer, instead of asking again for the same', async () => {
    // An 8,192-token model: this prompt leaves 2,935 tokens for an answer allowed 4,096 (plus
    // thinking room). More room can't be given, so a cut-off answer isn't handed back to be retried.
    show = { status: 200, json: { model_info: { 'general.architecture': 'gemma2', 'gemma2.context_length': 8192 } } }
    queue.push({ status: 200, json: { message: { content: '{"a": "cut' }, done_reason: 'length' } })
    const err = await ollama.call({ ...base, model: 'gemma2:2b', prompt: 'p'.repeat(15_000), maxOutputTokens: 4096 }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/about 2,935 tokens of answer in gemma2:2b’s window \(8,192\)/)
    expect(chats()).toHaveLength(1)
    expect(chats()[0].body.options.num_predict).toBe(2935)
    // When the request itself set the length, a cut-off answer comes back marked, so the AI layer
    // can ask again with more room.
    queue.push({ status: 200, json: { message: { content: 'long…' }, done_reason: 'length' } })
    const res = await ollama.call({ ...base, model: 'qwen3:8b' })
    expect(res.truncated).toBe(true)
  })

  it('sizes the live refusal test’s prompt so that its first try asks for the whole window', () => {
    // tests/llm/live-local.test.ts sends chinese(3 * (limit - 1000)) with maxOutputTokens 60.
    for (const limit of [2048, 8192, 32768, 40960, 65536]) {
      const req = { system: 'Answer briefly.', prompt: '字'.repeat(3 * (limit - 1000)), maxOutputTokens: 60 }
      expect(sizeFor(req)).not.toBeNull() // MarkOS's own check, before Ollama is asked
      expect(sizeFor(req, limit)?.numCtx).toBe(limit)
    }
  })

  it('says which model to pull when Ollama doesn’t have it', async () => {
    show = { status: 404, json: { error: 'model "qwen3:4b" not found' } }
    queue.push({ status: 404, json: { error: 'model "qwen3:4b" not found, try pulling it first' } })
    const err = await ollama.call({ ...base, model: 'qwen3:4b' }).catch(e => e)
    expect(err.kind).toBe('not_configured')
    expect(err.message).toContain('ollama pull qwen3:4b')
  })

  const tooLongForOllama = { status: 400, json: { error: 'the input length exceeds the context length' } }

  it('gives a prompt longer than MarkOS estimated a bigger window, never a cut one', async () => {
    // Text in some scripts runs about a token a character, so the estimate can be short.
    queue.push(tooLongForOllama, tooLongForOllama, { status: 200, json: { message: { content: 'read it all' }, done_reason: 'stop', prompt_eval_count: 30_000, eval_count: 3 } })
    const res = await ollama.call({ ...base, model: 'qwen3:8b' })
    expect(res.text).toBe('read it all')
    // Doubling, so the window (and the memory it takes) stays no bigger than needed.
    expect(chats().map(c => c.body.options.num_ctx)).toEqual([8192, 16384, 32768])
    expect(new Set(chats().map(c => c.body.options.num_predict)).size).toBe(1)
    expect(chats().every(c => c.body.truncate === false && c.body.shift === false)).toBe(true)
  })

  it('turns Ollama’s refusal at the model’s whole window into a clear message', async () => {
    queue.push(tooLongForOllama, tooLongForOllama, tooLongForOllama, tooLongForOllama)
    const err = await ollama.call({ ...base, model: 'qwen3:8b' }).catch(e => e)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/longer than qwen3:8b can take at once/)
    // Up to the window qwen3 was trained for, and no further.
    expect(chats().map(c => c.body.options.num_ctx)).toEqual([8192, 16384, 32768, 40960])
  })

  it('names MarkOS’s own window cap when that, not the model, is the limit', async () => {
    show = { status: 200, json: { model_info: { 'general.architecture': 'llama', 'llama.context_length': 131072 } } }
    queue.push(tooLongForOllama, tooLongForOllama, tooLongForOllama, tooLongForOllama)
    const err = await ollama.call({ ...base, model: 'llama3.1:8b' }).catch(e => e)
    expect(err.message).toMatch(/65,536-token window MarkOS gives a local model.*MARKOS_OLLAMA_MAX_CTX/)
    expect(chats().map(c => c.body.options.num_ctx)).toEqual([8192, 16384, 32768, 65536])
  })

  it('says to start Ollama only when nothing is listening', async () => {
    writeConnections({ ollama: { baseUrl: `http://127.0.0.1:${closedPort}` } })
    const err = await ollama.call({ ...base, model: 'qwen3:8b' }).catch(e => e)
    expect(err.kind).toBe('not_configured')
    expect(err.message).toMatch(/Ollama isn’t running/)
  })

  it('calls a dropped connection a network failure, which is retried', async () => {
    queue.push('drop')
    const err = await ollama.call({ ...base, model: 'qwen3:8b' }).catch(e => e)
    expect(err.kind).toBe('network')
    expect(err.message).not.toMatch(/isn’t running/)
  })

  it('never claims a web search', async () => {
    await expect(ollama.call({ ...base, grounded: true })).rejects.toBeInstanceOf(ProviderError)
    expect(seen).toHaveLength(0)
  })
})
