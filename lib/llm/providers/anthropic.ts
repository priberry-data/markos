import Anthropic from '@anthropic-ai/sdk'
import { Provider, ProviderError, ProviderRequest, ProviderResponse, Source } from '../types'

// Claude, kept as an option per agent (Settings). Gemini is the default because
// of cost.

let client: Anthropic | null = null
function getClient(): Anthropic {
  // SDK retries are off: the AI layer owns retry policy for every provider.
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 })
  return client
}

function classify(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError('Cancelled.', 'aborted')
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('The Anthropic API key is invalid. Update ANTHROPIC_API_KEY in .env.local.', 'auth', 401)
  }
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('Claude rate limit hit.', 'rate_limit', 429)
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message.toLowerCase()
    if (msg.includes('credit balance') || msg.includes('billing')) {
      return new ProviderError('The Anthropic account is out of credit.', 'billing', 400)
    }
    return new ProviderError(`Claude rejected the request: ${err.message.slice(0, 300)}`, 'bad_request', 400)
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('Claude took too long to answer.', 'timeout')
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('Could not reach Claude.', 'network')
  if (err instanceof Anthropic.InternalServerError) {
    return err.status === 529
      ? new ProviderError('Claude is overloaded right now.', 'overloaded', 529)
      : new ProviderError(`Claude server error (${err.status}).`, 'server', err.status)
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(`Claude error (${err.status}): ${err.message.slice(0, 300)}`, 'server', err.status)
  }
  return new ProviderError(String(err), 'network')
}

function supportsWebSearch(model: string) {
  return model.startsWith('claude-sonnet-5') || model.startsWith('claude-opus-5')
}

export const anthropic: Provider = {
  id: 'anthropic',

  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new ProviderError('ANTHROPIC_API_KEY is not set in .env.local.', 'not_configured')
    }
    if (req.grounded && !supportsWebSearch(req.model)) {
      throw new ProviderError(`${req.model} cannot search the web; use Sonnet 5 or Opus 5.`, 'bad_request')
    }

    const isHaiku = req.model.includes('haiku')
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      stream: true,
    }
    if (!isHaiku) {
      params.thinking = req.reasoning === 'deep' ? { type: 'adaptive' } : { type: 'disabled' }
    }
    if (req.jsonSchema) {
      params.output_config = { format: { type: 'json_schema', schema: req.jsonSchema } }
    }
    if (req.grounded) {
      params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]
    }

    let message: Anthropic.Message
    try {
      message = await getClient().messages.stream(params, { signal: req.signal }).finalMessage()
    } catch (err) {
      throw classify(err)
    }

    if (message.stop_reason === 'refusal') {
      throw new ProviderError('Claude declined this request.', 'bad_request')
    }

    // Every text block — the old code read only content[0].
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()

    const sources: Source[] = []
    const seen = new Set<string>()
    for (const block of message.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type === 'web_search_result' && !seen.has(r.url)) {
            seen.add(r.url)
            sources.push({ title: r.title, url: r.url })
          }
        }
      }
    }

    return {
      text,
      sources,
      usage: {
        inputTokens:
          message.usage.input_tokens +
          (message.usage.cache_read_input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
        groundedRequests: message.usage.server_tool_use?.web_search_requests ?? 0,
      },
      finishReason: message.stop_reason,
      truncated: message.stop_reason === 'max_tokens',
    }
  },
}
