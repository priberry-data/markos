import { geminiKey } from '../connection'
import { Provider, ProviderError, ProviderRequest, ProviderResponse, Source } from '../types'

// Google Gemini via the native generateContent endpoint.
//
// The native endpoint (not the OpenAI-compatibility one) is required for the
// built-in google_search grounding tool. Two lessons carried over from the
// grounded-search helper in an earlier project:
//   - Gemini thinks by default, and that invisible thinking counts against
//     maxOutputTokens. Left unmanaged it can consume the whole budget and return
//     an empty reply that looks like "nothing found". Thinking is always set
//     explicitly here, and room for it is added on top of the output budget.
//   - A failed search must never be reported as an empty result.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// The grounding tool's field name, learned at runtime (see the retry in call()).
let searchToolKey: 'google_search' | 'googleSearch' = 'google_search'
const TIMEOUT_MS = 180_000

// Gemini 3 models that accept thinkingLevel "minimal". Everywhere else the
// floor is "low" — thinking cannot be switched off on Gemini 3, so asking for
// a level a model doesn't support is a 400, not a cheaper call.
const MINIMAL_THINKING = new Set(['gemini-3.6-flash', 'gemini-3.5-flash-lite'])

function thinkingConfig(model: string, reasoning: ProviderRequest['reasoning']) {
  const level = reasoning ?? 'none'
  if (model.startsWith('gemini-3')) {
    // Gemini 3 takes a level, not a token budget.
    const thinkingLevel =
      level === 'deep' ? 'high' : level === 'light' ? 'low' : MINIMAL_THINKING.has(model) ? 'minimal' : 'low'
    return {
      config: { thinkingLevel },
      extraTokens: thinkingLevel === 'high' ? 16384 : thinkingLevel === 'low' ? 4096 : 1024,
    }
  }
  if (model.startsWith('gemini-2.5')) {
    // Legacy: an explicit token budget. Pro cannot turn thinking off; 128 is its minimum.
    const floor = model.includes('pro') ? 128 : 0
    const budget = level === 'deep' ? 8192 : level === 'light' ? 2048 : floor
    return { config: { thinkingBudget: budget }, extraTokens: budget }
  }
  return { config: undefined, extraTokens: 0 }
}

function classify(status: number, message: string): ProviderError {
  const m = message.toLowerCase()
  if (status === 400 && (m.includes('api key') || m.includes('api_key'))) {
    return new ProviderError('The Gemini API key is invalid. Update it in Settings → Your AI.', 'auth', status)
  }
  if (status === 401 || status === 403) {
    return new ProviderError('Gemini rejected the API key or this key lacks access to the model.', 'auth', status)
  }
  if (status === 429) {
    // A per-day or billing quota won't recover by retrying in a few seconds.
    if (m.includes('per day') || m.includes('billing') || m.includes('exceeded your current quota')) {
      return new ProviderError('The Gemini quota for this key is used up (daily limit or billing).', 'billing', status)
    }
    return new ProviderError('Gemini rate limit hit.', 'rate_limit', status)
  }
  if (status === 503) return new ProviderError('Gemini is overloaded right now.', 'overloaded', status)
  if (status >= 500) return new ProviderError(`Gemini server error (${status}).`, 'server', status)
  return new ProviderError(`Gemini rejected the request (${status}): ${message.slice(0, 300)}`, 'bad_request', status)
}

/**
 * Grounding links are Google redirect URLs. Resolve them to the real page so
 * the founder sees (and can open) the actual source. Falls back to the redirect
 * link if resolution fails.
 */
async function resolveSourceUrl(url: string): Promise<string> {
  if (!url.includes('grounding-api-redirect')) return url
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5_000) })
    return res.headers.get('location') ?? url
  } catch {
    return url
  }
}

/**
 * Sources in grounding-chunk order, so citation marker [n] is sources[n-1].
 * Not deduplicated here for that reason — callers dedupe when storing.
 */
async function extractSources(candidate: GeminiCandidate): Promise<Source[]> {
  const chunks = candidate.groundingMetadata?.groundingChunks ?? []
  return Promise.all(
    chunks.map(async c => ({
      title: c.web?.title ?? '',
      url: c.web?.uri ? await resolveSourceUrl(c.web.uri) : '',
    }))
  )
}

/**
 * Put [n] markers after each sentence Gemini says came from source n, so the
 * next step knows which source backs which claim instead of guessing from
 * titles. Segment offsets are UTF-8 byte offsets, so insert on the byte buffer.
 */
function annotateCitations(text: string, candidate: GeminiCandidate): string {
  const supports = candidate.groundingMetadata?.groundingSupports ?? []
  if (supports.length === 0) return text
  const buf = Buffer.from(text, 'utf8')
  const inserts = supports
    .map(s => ({
      at: s.segment?.endIndex ?? -1,
      mark: (s.groundingChunkIndices ?? []).map(i => `[${i + 1}]`).join(''),
    }))
    .filter(i => i.at > 0 && i.at <= buf.length && i.mark)
    .sort((a, b) => b.at - a.at)
  let out = buf
  for (const { at, mark } of inserts) {
    out = Buffer.concat([out.subarray(0, at), Buffer.from(mark, 'utf8'), out.subarray(at)])
  }
  return out.toString('utf8')
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string; thought?: boolean }> }
  finishReason?: string
  groundingMetadata?: {
    webSearchQueries?: string[]
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
    groundingSupports?: Array<{
      segment?: { startIndex?: number; endIndex?: number }
      groundingChunkIndices?: number[]
    }>
  }
}

export const gemini: Provider = {
  id: 'gemini',

  isConfigured: () => Boolean(geminiKey()),

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const key = geminiKey()
    if (!key) {
      throw new ProviderError('No Gemini key yet. Add one in Settings → Your AI.', 'not_configured')
    }
    if (req.grounded && req.jsonSchema) {
      throw new ProviderError('Grounded search and a fixed JSON schema must be separate calls.', 'bad_request')
    }

    const thinking = thinkingConfig(req.model, req.reasoning)
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxOutputTokens + thinking.extraTokens,
      temperature: req.temperature ?? (req.jsonSchema ? 0.2 : 0.7),
    }
    if (thinking.config) generationConfig.thinkingConfig = thinking.config
    if (req.jsonSchema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseJsonSchema = req.jsonSchema
    }

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig,
    }

    const signal = req.signal
      ? AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS)

    const send = async (searchKey: string) => {
      const payload = req.grounded ? { ...body, tools: [{ [searchKey]: {} }] } : body
      try {
        return await fetch(`${BASE}/${encodeURIComponent(req.model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(payload),
          signal,
        })
      } catch (err) {
        if (req.signal?.aborted) throw new ProviderError('Cancelled.', 'aborted')
        const name = (err as Error)?.name
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new ProviderError('Gemini took too long to answer.', 'timeout')
        }
        throw new ProviderError(`Could not reach Gemini: ${(err as Error)?.message ?? err}`, 'network')
      }
    }

    const errorBody = async (r: Response) => {
      const text = await r.text().catch(() => '')
      try {
        return (JSON.parse(text)?.error?.message as string) ?? text
      } catch {
        return text
      }
    }

    let res = await send(searchToolKey)
    // The search tool's field name has changed spelling between API versions.
    // If this one is rejected as unknown, try the other and remember which
    // worked, so it costs one wasted request per process at most.
    if (!res.ok && res.status === 400 && req.grounded) {
      const message = await errorBody(res)
      if (/unknown name|invalid json payload|google_?search/i.test(message)) {
        const other = searchToolKey === 'google_search' ? 'googleSearch' : 'google_search'
        const retry = await send(other)
        if (retry.ok) searchToolKey = other
        res = retry
      } else {
        throw classify(400, message)
      }
    }

    if (!res.ok) throw classify(res.status, await errorBody(res))

    const json = (await res.json()) as {
      candidates?: GeminiCandidate[]
      promptFeedback?: { blockReason?: string }
      usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        thoughtsTokenCount?: number
        toolUsePromptTokenCount?: number
      }
    }

    const candidate = json.candidates?.[0]
    if (!candidate) {
      const reason = json.promptFeedback?.blockReason
      throw new ProviderError(
        reason ? `Gemini declined the request (${reason}).` : 'Gemini returned no answer.',
        reason ? 'bad_request' : 'empty'
      )
    }

    // Thinking parts are the model's scratchpad — never part of the answer.
    const raw = (candidate.content?.parts ?? [])
      .filter(p => !p.thought && typeof p.text === 'string')
      .map(p => p.text)
      .join('')
    const text = (req.grounded ? annotateCitations(raw, candidate) : raw).trim()

    const usage = json.usageMetadata ?? {}
    const finishReason = candidate.finishReason ?? null
    const searched = (candidate.groundingMetadata?.webSearchQueries?.length ?? 0) > 0

    return {
      text,
      sources: req.grounded ? await extractSources(candidate) : [],
      usage: {
        inputTokens: (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0),
        // Thinking tokens are billed as output.
        outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        groundedRequests: req.grounded && searched ? 1 : 0,
      },
      finishReason,
      truncated: finishReason === 'MAX_TOKENS',
    }
  },
}

/** Model ids this key can call with generateContent — to check configured ids still exist. */
export async function listGeminiModels(): Promise<string[]> {
  const key = geminiKey()
  if (!key) throw new ProviderError('No Gemini key yet. Add one in Settings → Your AI.', 'not_configured')
  const ids: string[] = []
  let pageToken = ''
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${BASE}?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw classify(res.status, await res.text().catch(() => ''))
    const body = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string }
    for (const m of body.models ?? []) {
      if (m.supportedGenerationMethods?.includes('generateContent')) ids.push(m.name.replace(/^models\//, ''))
    }
    if (!body.nextPageToken) break
    pageToken = body.nextPageToken
  }
  return ids
}
