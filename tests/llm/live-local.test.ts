import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configureAccounting, generateObject } from '@/lib/llm'
import { writeConnections } from '@/lib/llm/connection'
import { setModelOverrides } from '@/lib/llm/models'
import { listOllamaModels, ollama, sizeFor } from '@/lib/llm/providers/ollama'
import { listCompatModels, openaiCompat } from '@/lib/llm/providers/openai-compat'
import { ProviderError } from '@/lib/llm/types'

// A real model, not a stub: runs only where MARKOS_LIVE_OLLAMA names a model
// that Ollama has pulled (the local-ai job in CI does this with a small one).
// Ollama also serves the OpenAI chat-completions API at /v1, so the same model
// checks the OpenAI-compatible provider against a real server.

const model = process.env.MARKOS_LIVE_OLLAMA
const base = process.env.MARKOS_LIVE_OLLAMA_URL ?? 'http://127.0.0.1:11434'

/** Varied Chinese characters, each used once in 20,000: a token or more each, depending on the model. `from` starts further along. */
const chinese = (length: number, from = 0) => Array.from({ length }, (_, i) => String.fromCodePoint(0x4e00 + (((from + i) * 7919) % 20_000))).join('')

/** How many tokens Ollama reads for `text`, from a one-token answer in a window with room to spare. */
async function tokensOf(text: string): Promise<number> {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, truncate: false, messages: [{ role: 'user', content: text }], options: { num_ctx: 8192, num_predict: 1 } }),
  })
  const n = ((await res.json()) as { prompt_eval_count?: number }).prompt_eval_count
  if (typeof n !== 'number') throw new Error(`Ollama didn’t say how many tokens it read (HTTP ${res.status})`)
  return n
}

/** The window the model was trained for, as Ollama reports it. */
async function trainedWindow(): Promise<number> {
  const res = await fetch(`${base}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })
  const info = ((await res.json()) as { model_info?: Record<string, unknown> }).model_info ?? {}
  const n = Object.entries(info).find(([k, v]) => k.endsWith('.context_length') && typeof v === 'number')?.[1]
  if (typeof n !== 'number') throw new Error('Ollama didn’t say how long a window this model was trained for')
  return n
}
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'markos-live-'))
const saved = { home: process.env.MARKOS_HOME, force: process.env.MARKOS_FORCE_MODEL }

describe.skipIf(!model)('a real local model', () => {
  beforeAll(() => {
    process.env.MARKOS_HOME = home
    delete process.env.MARKOS_FORCE_MODEL
    configureAccounting({ record: async () => {}, lookupSpent: async () => 0 })
  })
  afterAll(() => {
    setModelOverrides({})
    if (saved.home === undefined) delete process.env.MARKOS_HOME
    else process.env.MARKOS_HOME = saved.home
    if (saved.force !== undefined) process.env.MARKOS_FORCE_MODEL = saved.force
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('is listed by both APIs', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    expect(await listOllamaModels()).toContain(model)
    expect(await listCompatModels({ baseUrl: `${base}/v1` })).toContain(model)
  })

  it('answers through the native Ollama provider', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    const res = await ollama.call({ model: model!, system: 'Answer in one short sentence.', prompt: 'Say hello.', maxOutputTokens: 60 })
    expect(res.text.length).toBeGreaterThan(0)
    expect(res.usage.outputTokens).toBeGreaterThan(0)
  }, 300_000)

  it('refuses a prompt longer than the model was trained for, instead of letting Ollama shrink the window', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    // ~40k tokens: inside MarkOS's own cap, beyond what a small model was trained for.
    const err = await ollama.call({ model: model!, system: 'Answer briefly.', prompt: 'word '.repeat(24_000), maxOutputTokens: 60 }).catch(e => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe('bad_request')
    expect(err.message).toMatch(/can take at once \(\d[\d,]*\)/)
  }, 300_000)

  it('makes Ollama refuse a prompt longer than the model’s whole window, never cut it short', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    // Chinese text runs about a token a character, three times what MarkOS's estimate assumes.
    // Sized from the window MarkOS will ask for (the model's own, within MarkOS's cap) so that
    // even the first try asks for all of it (tests/llm/openai-compat.test.ts checks that sizing):
    // the real prompt is about three times longer, and Ollama must fail, not drop the start.
    const window = await trainedWindow()
    const limit = Math.min(window, Number(process.env.MARKOS_OLLAMA_MAX_CTX) || 65536)
    const prompt = chinese(3 * (limit - 1000))
    const res = await ollama.call({ model: model!, system: 'Answer briefly.', prompt, maxOutputTokens: 60 }).catch(e => e)
    if (!(res instanceof ProviderError)) throw new Error(`Ollama answered a prompt that didn’t fit instead of refusing it: ${JSON.stringify(res).slice(0, 200)}`)
    console.log(`[live] Ollama refused the oversized prompt (window ${window}): ${res.kind}: ${res.message}`)
    expect(res.message).toMatch(/longer than|context|exceed/i)
    expect(res.message).not.toMatch(/isn’t running/)
  }, 300_000)

  it('gives a prompt longer than MarkOS estimated a bigger window, and Ollama reads all of it', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    // How many tokens this model makes of such text, measured on text the prompt below doesn't
    // start with (so Ollama has none of the prompt cached when it reads it).
    const perChar = (await tokensOf(chinese(2000, 10_000))) / 2000
    // About 10,000 real tokens: more than the 8,192-token window MarkOS asks for first (its
    // estimate assumes three characters a token), so Ollama refuses that one and MarkOS asks
    // again with twice the window; and short enough for a CPU to read in a minute or two.
    // A one-word reply, so the time goes on reading the prompt, not on writing an answer.
    const ask = 'Reply with the single word OK.'
    const req = { model: model!, system: ask, prompt: `${chinese(Math.round(10_000 / perChar))}\n\n${ask}`, maxOutputTokens: 60, temperature: 0 }
    expect(sizeFor(req)?.numCtx).toBe(8192)
    const res = await ollama.call({ ...req, signal: AbortSignal.timeout(540_000) })
    console.log(`[live] Ollama read ${res.usage.inputTokens} prompt tokens after the window grew (${perChar.toFixed(2)} tokens a character)`)
    expect(res.usage.inputTokens).toBeGreaterThan(8192)
  }, 600_000)

  it('fills a fixed format through the whole AI layer, with the team on Ollama', async () => {
    writeConnections({ ollama: { baseUrl: base } })
    setModelOverrides({ _default: `ollama:${model}` })
    const { data, model: used } = await generateObject({ agent: 'cmo' }, {
      system: 'You write short marketing notes.',
      prompt: 'Give one headline for a free invoicing app, and how many words it has.',
      schema: z.object({ headline: z.string().min(1), words: z.number() }),
      maxOutputTokens: 200,
    })
    expect(used).toEqual({ provider: 'ollama', model })
    expect(data.headline.length).toBeGreaterThan(0)
  }, 300_000)

  it('answers and fills a format through the OpenAI-compatible provider', async () => {
    writeConnections({ compat: { preset: 'custom', baseUrl: `${base}/v1` } })
    const text = await openaiCompat.call({ model: model!, system: 'Answer in one short sentence.', prompt: 'Say hello.', maxOutputTokens: 60 })
    expect(text.text.length).toBeGreaterThan(0)
    setModelOverrides({ _default: `openai-compat:${model}` })
    const { data } = await generateObject({ agent: 'cmo' }, {
      system: 'You write short marketing notes.',
      prompt: 'Give one headline for a free invoicing app.',
      schema: z.object({ headline: z.string().min(1) }),
      maxOutputTokens: 200,
    })
    expect(data.headline.length).toBeGreaterThan(0)
  }, 300_000)
})
