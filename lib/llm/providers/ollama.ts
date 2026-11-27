import { ollamaChosen, ollamaUrl } from '../connection'
import { isLocalUrl } from '../presets'
import { connectTimedOut, connectionRefused, slowFetch } from '../slow-fetch'
import { Provider, ProviderError, ProviderRequest, ProviderResponse } from '../types'
import { stripThinking } from './openai-compat'

// Free models on this computer through Ollama's native API.
//
// Not the OpenAI-compatible endpoint: that one can't set the context size, and
// Ollama's default (4k tokens on most laptops) would silently cut off MarkOS's
// prompts, which carry the product's whole context. Here every call asks for a
// window that fits its whole prompt and the answer (all of it when the model's window
// allows, else what the prompt leaves), within what the model was trained for (Ollama
// quietly shrinks a bigger window to that). Ollama is told to fail rather than drop
// part of a prompt. When the estimate was short, the window grows until the prompt fits
// and it asks again; the answer then gets what the prompt leaves of that window.

const TIMEOUT_MS = 900_000
const MIN_CTX = 8192
// Raise with MARKOS_OLLAMA_MAX_CTX on a machine with memory to spare.
const MAX_CTX = Number(process.env.MARKOS_OLLAMA_MAX_CTX) || 65536
// The chat template and the model's own markers around the messages.
const TEMPLATE_ROOM = 256
// The least answer worth asking for: when a prompt leaves less, the step is too long for the window.
const MIN_ANSWER = 1024

type Sizable = Pick<ProviderRequest, 'system' | 'prompt' | 'maxOutputTokens' | 'jsonSchema' | 'reasoning'>

/** The prompt in tokens: ~3.5 characters a token in English, so err high. */
function promptTokens(req: Sizable): number {
  const chars = req.system.length + req.prompt.length + (req.jsonSchema ? JSON.stringify(req.jsonSchema).length : 0)
  return Math.ceil(chars / 3) + TEMPLATE_ROOM
}

/** The answer's length when the window doesn't limit it: the answer plus room for a reasoning model to think. */
function wantedAnswer(req: Sizable): number {
  return req.maxOutputTokens + (req.reasoning === 'deep' ? 8192 : 2048)
}

/**
 * The answer's length first: wantedAnswer, or what the prompt leaves of the window when that's
 * less (the answer's length is a ceiling; most answers are far shorter). Then a window that fits
 * the prompt and that answer, rounded up to a power of two, within `limit`. Null only when the
 * prompt leaves too little room for any answer.
 */
export function sizeFor(req: Sizable, limit = MAX_CTX): { numCtx: number; numPredict: number } | null {
  const prompt = promptTokens(req)
  const left = limit - prompt
  if (left < Math.min(req.maxOutputTokens, MIN_ANSWER)) return null
  const numPredict = Math.min(wantedAnswer(req), left)
  let numCtx = MIN_CTX
  while (numCtx < prompt + numPredict) numCtx *= 2
  return { numCtx: Math.min(numCtx, limit), numPredict }
}

/** The window one call gets (the largest MarkOS allows when even that is too small). */
export function contextFor(req: Sizable, limit = MAX_CTX): number {
  return sizeFor(req, limit)?.numCtx ?? limit
}

const trained = new Map<string, number | null>()

/** The longest window this model was trained for, from /api/show; null when Ollama doesn't say. */
async function trainedContext(base: string, model: string, signal: AbortSignal): Promise<number | null> {
  const key = `${base}|${model}`
  if (trained.has(key)) return trained.get(key)!
  try {
    const res = await slowFetch(`${base}/api/show`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!res.ok) return null // a missing model is reported by the call itself
    const info = ((await res.json()) as { model_info?: Record<string, unknown> }).model_info ?? {}
    const n = Object.entries(info).find(([k, v]) => k.endsWith('.context_length') && typeof v === 'number')?.[1] as number | undefined
    const value = n && n > 0 ? n : null
    trained.set(key, value)
    return value
  } catch (err) {
    // Nothing listening, or nothing answering at all: the chat would fail the same way, so say so now.
    if (connectionRefused(err) || connectTimedOut(err)) throw err
    return null // cancelled or slow: the call itself says which
  }
}

const ASK_ELSEWHERE = {
  own: 'Run this agent on a hosted AI in Settings, or set MARKOS_OLLAMA_MAX_CTX if your computer has the memory.',
  model: 'Run this agent on a model with a longer window, or on a hosted AI, in Settings.',
}

function tooLong(req: Sizable, model: string, window: number, ownCap: boolean): ProviderError {
  const prompt = promptTokens(req).toLocaleString('en')
  const w = window.toLocaleString('en')
  return new ProviderError(
    ownCap
      ? `This step is about ${prompt} tokens long: with room left for an answer, that's more than the ${w}-token window MarkOS gives a local model. ${ASK_ELSEWHERE.own}`
      : `This step is about ${prompt} tokens long: with room left for an answer, that's more than ${model} can take at once (${w}). ${ASK_ELSEWHERE.model}`,
    'bad_request',
  )
}

/** A request to Ollama that got no answer, in words the founder can act on. */
function unreached(err: unknown, base: string, req: ProviderRequest): ProviderError {
  if (req.signal?.aborted) return new ProviderError('Cancelled.', 'aborted')
  const e = err as Error & { cause?: { message?: string } }
  // Not retried: a model too slow once will be too slow again.
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new ProviderError(`${req.model} took more than 15 minutes to answer. Try a smaller model in Settings.`, 'bad_request')
  // Not retried either: nothing will answer until the founder starts Ollama or lets this computer in.
  if (connectionRefused(err)) {
    return new ProviderError(
      isLocalUrl(base)
        ? `Ollama isn’t running at ${base}. Open the Ollama app (or run \`ollama serve\`), then try again.`
        : `Nothing is answering at ${base}. Start Ollama on that computer, then try again.`,
      'not_configured',
    )
  }
  if (connectTimedOut(err)) {
    return new ProviderError(`Nothing answered at ${base}. Check that Ollama is running on that computer and that its firewall lets this one in.`, 'not_configured')
  }
  // Anything else (a dropped connection) is worth another try.
  return new ProviderError(`Could not reach Ollama at ${base}: ${e?.cause?.message ?? e?.message ?? err}`, 'network')
}

export const ollama: Provider = {
  id: 'ollama',

  isConfigured: () => ollamaChosen(),

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    if (req.grounded) throw new ProviderError('Ollama models can’t search the web from MarkOS.', 'bad_request')
    const base = ollamaUrl().replace(/\/+$/, '')
    // Too long for any window MarkOS allows: say so before asking Ollama anything.
    if (!sizeFor(req, MAX_CTX)) throw tooLong(req, req.model, MAX_CTX, true)
    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
    let modelWindow: number | null
    try {
      modelWindow = await trainedContext(base, req.model, signal)
    } catch (err) {
      throw unreached(err, base, req)
    }
    // The window can't pass what the model was trained for, nor MarkOS's own cap.
    const ownCap = modelWindow === null || modelWindow >= MAX_CTX
    const limit = ownCap ? MAX_CTX : modelWindow!
    const size = sizeFor(req, limit)
    if (!size) throw tooLong(req, req.model, limit, ownCap)

    const send = (numCtx: number) => {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }],
        stream: false,
        // If the prompt is ever longer than the window, fail rather than drop its start (truncate)
        // or slide the window during the answer (shift): either would lose the product's context.
        truncate: false,
        shift: false,
        options: {
          num_ctx: numCtx,
          num_predict: size.numPredict,
          temperature: req.temperature ?? (req.jsonSchema ? 0.2 : 0.7),
        },
      }
      // Ollama constrains the output to the schema itself.
      if (req.jsonSchema) body.format = req.jsonSchema
      // Not Node's fetch: it gives up after 300 seconds without a reply, and a local model
      // can read a long prompt for longer than that before it answers.
      return slowFetch(`${base}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      })
    }

    let numCtx = size.numCtx
    let res: Response
    for (;;) {
      try {
        res = await send(numCtx)
      } catch (err) {
        throw unreached(err, base, req)
      }
      if (res.ok) break
      const text = await res.text().catch(() => '')
      let message = text
      try { message = JSON.parse(text)?.error ?? text } catch { /* plain text */ }
      if (res.status === 404 || /not found|pull/i.test(message)) {
        throw new ProviderError(`Ollama doesn’t have the model “${req.model}”. In a terminal run: ollama pull ${req.model}`, 'not_configured', res.status)
      }
      if (/memory|out of memory|requires more system memory/i.test(message)) {
        throw new ProviderError(`This computer doesn’t have enough memory for ${req.model}. Pick a smaller model in Settings.`, 'bad_request', res.status)
      }
      if (/context|exceed/i.test(message)) {
        // MarkOS's estimate of the prompt's length was short (text in some scripts runs about a
        // token a character): ask again with twice the window, up to the largest allowed. Doubling,
        // not the largest at once, so the window (and the memory it takes) stays no bigger than needed.
        if (numCtx < limit) {
          numCtx = Math.min(numCtx * 2, limit)
          continue
        }
        throw new ProviderError(
          ownCap
            ? `This step is longer than the ${MAX_CTX.toLocaleString('en')}-token window MarkOS gives a local model, so Ollama refused it rather than cut it short. ${ASK_ELSEWHERE.own}`
            : `This step is longer than ${req.model} can take at once, so Ollama refused it rather than cut it short. ${ASK_ELSEWHERE.model}`,
          'bad_request', res.status,
        )
      }
      throw new ProviderError(`Ollama error (${res.status}): ${message.slice(0, 300)}`, res.status >= 500 ? 'server' : 'bad_request', res.status)
    }

    const json = (await res.json()) as {
      message?: { content?: string }
      done_reason?: string
      prompt_eval_count?: number
      eval_count?: number
    }
    const finishReason = json.done_reason ?? null
    // Cut off where the window, not the request, set the answer's length: asking again with more
    // room (what the AI layer does with a cut-off answer) would send this same request, so say
    // what would help instead.
    if (finishReason === 'length' && size.numPredict < wantedAnswer(req)) {
      const room = size.numPredict.toLocaleString('en')
      throw new ProviderError(
        ownCap
          ? `The answer didn’t fit: this step’s prompt leaves room for about ${room} tokens of answer in the ${MAX_CTX.toLocaleString('en')}-token window MarkOS gives a local model, and it needed more. ${ASK_ELSEWHERE.own}`
          : `The answer didn’t fit: this step’s prompt leaves room for about ${room} tokens of answer in ${req.model}’s window (${limit.toLocaleString('en')}), and it needed more. ${ASK_ELSEWHERE.model}`,
        'bad_request',
      )
    }
    return {
      text: stripThinking(json.message?.content ?? ''),
      sources: [],
      usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0, groundedRequests: 0 },
      finishReason,
      truncated: finishReason === 'length',
      costUsd: 0,
    }
  },
}

/** Models already pulled into Ollama (GET /api/tags). */
export async function listOllamaModels(base = ollamaUrl()): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new ProviderError(`Ollama isn’t running at ${base}. Open the Ollama app (or run \`ollama serve\`), then try again.`, 'not_configured')
  }
  if (!res.ok) throw new ProviderError(`Ollama error (${res.status}).`, 'server', res.status)
  const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> }
  return (body.models ?? []).map(m => m.name ?? m.model).filter((n): n is string => !!n).sort()
}
