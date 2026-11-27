import { compatConnection } from '../connection'
import { isNearbyUrl, presetById } from '../presets'
import { connectTimedOut, connectionRefused, slowFetch } from '../slow-fetch'
import { Provider, ProviderError, ProviderRequest, ProviderResponse, Source } from '../types'

// Any AI that speaks the OpenAI chat-completions API: OpenAI, OpenRouter, Groq,
// DeepSeek, Mistral, Together, xAI, LM Studio, vLLM, llama.cpp, LiteLLM...
//
// These servers agree on the basics and differ on the details, so the request
// adapts once and remembers what worked for each server and model:
//   - the length limit is `max_completion_tokens` on some, `max_tokens` on others;
//   - some reasoning models refuse a custom temperature;
//   - structured output may be json_schema, json_object, or not supported at all
//     — then the schema goes into the instructions and MarkOS validates the
//     answer itself (generateObject repairs it once if it doesn't match).
// No tools are ever offered, so the model can't change anything on this computer.
// What a request learns is kept per server and model, but only once a request succeeds with it.

const HOSTED_TIMEOUT_MS = 180_000
// A model on a laptop CPU can take minutes for a long answer.
const LOCAL_TIMEOUT_MS = 600_000
// Reasoning models spend part of the limit thinking before they answer.
const THINKING_ROOM = { none: 1024, light: 4096, deep: 12288 } as const

interface Quirks {
  tokenParam: 'max_completion_tokens' | 'max_tokens'
  temperature: boolean
  format: 'json_schema' | 'json_object' | 'prompt'
  /** Extra room for thinking; dropped when a small model's context window can't fit it. */
  room: boolean
  /** The most output tokens this model accepts, once a server has said. */
  cap?: number
}
const quirks = new Map<string, Quirks>()

function startingQuirks(preset: string | undefined): Quirks {
  return {
    // OpenAI's reasoning models reject max_tokens; OpenRouter marks it deprecated.
    tokenParam: preset === 'openai' || preset === 'openrouter' ? 'max_completion_tokens' : 'max_tokens',
    temperature: true,
    format: 'json_schema',
    room: true,
  }
}

/** Strip a reasoning model's visible thinking, which some servers leave in the answer. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim()
}

function classify(status: number, message: string, host: string): ProviderError {
  const m = message.toLowerCase()
  // Some servers answer 403 for a request they refuse to serve (a moderation flag, a guardrail,
  // a region), which no new key would fix.
  if (status === 403 && /moderat|flagged|guardrail|safety|content (policy|filter)|not available in your (region|country)|unsupported_country|country, region/.test(m)) {
    return new ProviderError(`${host} refused this request: ${message.slice(0, 300)}`, 'bad_request', status)
  }
  if (status === 401 || status === 403) return new ProviderError(`${host} rejected the API key. Check it in Settings → Your AI.`, 'auth', status)
  if (status === 408) return new ProviderError(`${host} took too long to answer.`, 'timeout', status)
  // A spent balance or quota won't recover by retrying in a few seconds.
  if (status === 402 || /insufficient_quota|insufficient (credits|balance|funds)|exceeded your current quota|billing/.test(m)) {
    return new ProviderError(`The account at ${host} is out of credit.`, 'billing', status)
  }
  if (status === 404 || m.includes('model_not_found') || (m.includes('model') && m.includes('not found'))) {
    return new ProviderError(`${host} doesn't have that model: ${message.slice(0, 200)}. Use “List models” in Settings to pick one.`, 'bad_request', status)
  }
  if (status === 429) return new ProviderError(`${host} rate limit hit.`, 'rate_limit', status)
  if (status === 503 || status === 529) return new ProviderError(`${host} is overloaded right now.`, 'overloaded', status)
  if (status >= 500) return new ProviderError(`${host} server error (${status}).`, 'server', status)
  return new ProviderError(`${host} rejected the request (${status}): ${message.slice(0, 300)}`, 'bad_request', status)
}

/**
 * The window and the prompt's share of it, from "This model's maximum context length is 8192
 * tokens. However, you requested 13288 tokens (5096 in the messages, 8192 in the completion)",
 * vLLM's "This model's maximum context length is 8192 tokens and your request has 3000 input
 * tokens (8192 > 8192 - 3000)", or OpenRouter's "This endpoint's maximum context length is 32768
 * tokens. However, you requested about 34480 tokens (14000 of text input, 20480 in the output)",
 * where the prompt is every "of … input" part.
 */
function contextOverflow(message: string): { limit: number; prompt: number } | null {
  const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, '')) : NaN)
  const limit = num(message.match(/maximum context length is (\d[\d,]*)/i)?.[1])
  const parts = [...message.matchAll(/(\d[\d,]*) of [a-z]+ input\b/gi)].map(m => num(m[1]))
  const prompt = parts.length
    ? parts.reduce((a, b) => a + b, 0)
    : num((message.match(/(\d[\d,]*) (?:tokens )?in the messages/i) ?? message.match(/request has (\d[\d,]*) input tokens/i))?.[1])
  return Number.isFinite(limit) && Number.isFinite(prompt) ? { limit, prompt } : null
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const j = JSON.parse(text)
    return String(j?.error?.message ?? j?.message ?? j?.detail ?? text)
  } catch {
    return text
  }
}

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string; content?: string } }>
    }
    finish_reason?: string | null
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
}

export const openaiCompat: Provider = {
  id: 'openai-compat',

  isConfigured: () => compatConnection() !== null,

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const conn = compatConnection()
    if (!conn) throw new ProviderError('No OpenAI-compatible AI is set up. Choose one in Settings → Your AI.', 'not_configured')
    const preset = presetById(conn.preset)
    // On this computer or the local network: no bill, minutes to answer, nothing listening until started.
    const local = isNearbyUrl(conn.baseUrl)
    const host = preset?.id === 'custom' || !preset ? new URL(conn.baseUrl).host : preset.label.replace(/ \(.*\)$/, '')
    const searches = preset?.search === true
    if (req.grounded && !searches) {
      throw new ProviderError(`${host} can't search the web from MarkOS.`, 'bad_request')
    }

    const key = `${conn.baseUrl}|${req.model}`
    // This request's own copy: an adaptation that didn't lead to an answer is never remembered.
    const q: Quirks = { ...(quirks.get(key) ?? startingQuirks(preset?.id)) }
    // This request only: the answer length that fits beside this prompt in the model's window.
    let clamp: number | undefined
    // The answer length the last attempt asked for.
    let sent = 0

    const timeout = local ? LOCAL_TIMEOUT_MS : HOSTED_TIMEOUT_MS
    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)

    const build = () => {
      let system = req.system
      if (req.jsonSchema && q.format !== 'json_schema') {
        system += `\n\nAnswer with JSON only — no prose, no code fences — matching this JSON Schema:\n${JSON.stringify(req.jsonSchema)}`
      }
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: req.prompt }],
        stream: false,
      }
      sent = Math.min(req.maxOutputTokens + (q.room ? THINKING_ROOM[req.reasoning ?? 'none'] : 0), q.cap ?? Infinity, clamp ?? Infinity)
      body[q.tokenParam] = sent
      if (q.temperature) body.temperature = req.temperature ?? (req.jsonSchema ? 0.2 : 0.7)
      if (req.jsonSchema && q.format === 'json_schema') {
        body.response_format = { type: 'json_schema', json_schema: { name: 'answer', schema: req.jsonSchema, strict: false } }
      } else if (req.jsonSchema && q.format === 'json_object') {
        body.response_format = { type: 'json_object' }
      }
      if (req.grounded && searches) body.plugins = [{ id: 'web', max_results: 5 }]
      return body
    }

    const send = async () => {
      const url = `${conn.baseUrl}/chat/completions`
      const init = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {}),
          ...(preset?.id === 'openrouter' ? { 'X-Title': 'MarkOS' } : {}),
        } as Record<string, string>,
        body: JSON.stringify(build()),
        signal,
      }
      try {
        // A model nearby can think for more than the 300 seconds Node's fetch waits for a reply.
        return await (local ? slowFetch(url, init) : fetch(url, init))
      } catch (err) {
        if (req.signal?.aborted) throw new ProviderError('Cancelled.', 'aborted')
        const e = err as Error & { cause?: { message?: string } }
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ProviderError(`${host} took too long to answer.`, 'timeout')
        // "Any other OpenAI-compatible API" names no server.
        const server = preset && preset.id !== 'custom' ? preset.label.replace(/ \(.*\)$/, '') : 'your AI server'
        // Not worth retrying: nothing will answer until the founder starts it, or lets this computer in.
        if (local && connectionRefused(err)) {
          throw new ProviderError(`Nothing is answering at ${conn.baseUrl}. Start ${server} (and load a model), then try again.`, 'not_configured')
        }
        if (local && connectTimedOut(err)) {
          throw new ProviderError(`Nothing answered at ${conn.baseUrl}. Check that ${server} is running on that computer and that its firewall lets this one in.`, 'not_configured')
        }
        throw new ProviderError(`Could not reach ${host}: ${e?.cause?.message ?? e?.message ?? err}`, 'network')
      }
    }

    // A few adaptations: context room, token parameter, temperature, output format.
    let res = await send()
    for (let adapt = 0; !res.ok && res.status === 400 && adapt < 4; adapt++) {
      const msg = (await errorText(res))
      const m = msg.toLowerCase()
      const tooBig = /too large|too many tokens|valid range|less than or equal|at most|maximum|exceed|context (length|window|size)|out of range|must be (<|less|between)/.test(m)
      const unsupported = /unsupported parameter|not supported|unrecognized|unknown (parameter|field)|use '?max_(completion_)?tokens'? instead|extra inputs/.test(m)
      const overflow = tooBig && !unsupported ? contextOverflow(msg) : null
      if (overflow) {
        // This prompt and the answer together overflow the window: the answer gets what this
        // prompt leaves, for this request only. A long prompt says nothing about the model, so
        // nothing is remembered: the next, shorter prompt gets the full length and thinking room.
        const room = overflow.limit - overflow.prompt - 64
        if (room < 256) {
          throw new ProviderError(
            `This step is about ${overflow.prompt.toLocaleString('en')} tokens long: with room left for an answer, that's more than ${req.model} can take at once (${overflow.limit.toLocaleString('en')}). ` +
            'Run this agent on a model with a longer window in Settings.',
            'bad_request', 400,
          )
        }
        if (room >= sent) throw classify(400, msg, host)
        clamp = room
      } else if (tooBig && !unsupported && q.room) {
        q.room = false
      } else if (tooBig && !unsupported) {
        // A limit on the answer itself: the largest one the server named below what was asked.
        // Never from a message about the context window, whose numbers are the prompt's and the window's.
        const named = /context (length|window|size)/.test(m) || !/(completion|output) tokens|max_(completion_)?tokens|max(imum)? tokens/.test(m)
          ? []
          : (msg.match(/\d[\d,]*/g) ?? []).map(n => Number(n.replace(/,/g, ''))).filter(n => n >= 256 && n < sent)
        if (!named.length) throw classify(400, msg, host)
        q.cap = Math.max(...named)
      } else if (m.includes('max_tokens') || m.includes('max_completion_tokens')) {
        q.tokenParam = q.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      } else if (m.includes('temperature') && q.temperature) {
        q.temperature = false
      } else if (req.jsonSchema && q.format !== 'prompt' && /response_format|json_schema|json_object|schema|structured/.test(m)) {
        q.format = q.format === 'json_schema' ? 'json_object' : 'prompt'
      } else {
        throw classify(400, msg, host)
      }
      res = await send()
    }
    if (!res.ok) throw classify(res.status, await errorText(res), host)
    quirks.set(key, q)

    const json = (await res.json().catch(() => ({}))) as ChatResponse
    const choice = json.choices?.[0]
    if (!choice) throw new ProviderError(`${host} returned no answer.`, 'empty')
    const text = stripThinking(choice.message?.content ?? '')

    const sources: Source[] = []
    const evidence: string[] = []
    const seen = new Set<string>()
    for (const a of choice.message?.annotations ?? []) {
      const c = a.type === 'url_citation' ? a.url_citation : undefined
      if (!c?.url || seen.has(c.url)) continue
      seen.add(c.url)
      sources.push({ title: c.title ?? c.url, url: c.url })
      if (c.content) evidence.push(`${c.title ?? ''} — ${c.url}\n${c.content}`)
    }

    const finishReason = choice.finish_reason ?? null
    return {
      text,
      sources,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        groundedRequests: req.grounded && sources.length > 0 ? 1 : 0,
      },
      finishReason,
      truncated: finishReason === 'length',
      // OpenRouter reports what the call cost; a model on this computer costs nothing.
      costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : local ? 0 : undefined,
      evidence: evidence.length ? `${text}\n\nWEB RESULTS:\n${evidence.join('\n\n')}` : undefined,
    }
  },
}

/** The model ids a compat server offers (GET /models). */
export async function listCompatModels(conn: { baseUrl: string; apiKey?: string }): Promise<string[]> {
  const res = await fetch(`${conn.baseUrl}/models`, {
    headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw classify(res.status, await errorText(res), new URL(conn.baseUrl).host)
  const body = (await res.json()) as { data?: Array<{ id?: string }> }
  return (body.data ?? []).map(m => m.id).filter((id): id is string => typeof id === 'string').sort()
}
