// Shared types for the provider-neutral AI layer.

export type ProviderId = 'claude-code' | 'gemini' | 'anthropic' | 'fake'

export interface ModelRef {
  provider: ProviderId
  model: string
}

export interface Source {
  title: string
  url: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Number of grounded (web-searched) requests billed for this call. */
  groundedRequests: number
}

/** What a provider is asked to do. Providers stay thin: no retries, no validation. */
export interface ProviderRequest {
  model: string
  system: string
  prompt: string
  /** Enable the provider's live web search. Never combined with jsonSchema. */
  grounded?: boolean
  /** Constrain the reply to this JSON Schema. Never combined with grounded. */
  jsonSchema?: Record<string, unknown>
  maxOutputTokens: number
  temperature?: number
  /** Let the model think before answering. Off for pure reshaping calls. */
  reasoning?: 'none' | 'light' | 'deep'
  /**
   * Local folders the model may read (a product's repo). Read-only, and only
   * honoured by providers that can read files (Claude Code).
   */
  readPaths?: string[]
  signal?: AbortSignal
}

export interface ProviderResponse {
  text: string
  sources: Source[]
  usage: Usage
  /** Provider-specific stop reason, e.g. STOP, MAX_TOKENS, end_turn. */
  finishReason: string | null
  /** True when the reply was cut off by the token limit. */
  truncated: boolean
  /** Cost as reported by the provider itself, when it knows better than the price table. */
  costUsd?: number
  /**
   * The raw text the web tools returned (search results, fetched pages), when
   * the provider exposes it. A claim "found on the web" is checked against
   * this, not against the model's own summary.
   */
  evidence?: string
}

export interface Provider {
  id: ProviderId
  isConfigured(): boolean
  call(req: ProviderRequest): Promise<ProviderResponse>
}

/** A provider-level failure, classified so callers can decide what to do. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'auth' | 'billing' | 'usage_limit' | 'rate_limit' | 'overloaded' | 'bad_request' | 'server' | 'network' | 'timeout' | 'aborted' | 'empty',
    readonly status?: number,
    /** For usage_limit: when the plan's limit resets, if the provider said. */
    readonly resetAt?: Date,
  ) {
    super(message)
    this.name = 'ProviderError'
  }

  /** Worth retrying after a pause. */
  get transient(): boolean {
    return ['rate_limit', 'overloaded', 'server', 'network', 'timeout', 'empty'].includes(this.kind)
  }
}
