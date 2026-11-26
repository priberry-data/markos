import { Provider, ProviderRequest, ProviderResponse } from '../types'

// Deterministic provider for tests: no network, no cost. Tests install a handler
// that decides what each request returns.

export type FakeHandler = (req: ProviderRequest) => Partial<ProviderResponse> | Promise<Partial<ProviderResponse>>

let handler: FakeHandler = () => ({ text: '{}' })

export function setFakeHandler(h: FakeHandler) {
  handler = h
}

export const fake: Provider = {
  id: 'fake',
  isConfigured: () => true,
  async call(req) {
    if (req.signal?.aborted) {
      const { ProviderError } = await import('../types')
      throw new ProviderError('Cancelled.', 'aborted')
    }
    const r = await handler(req)
    return {
      text: r.text ?? '',
      sources: r.sources ?? [],
      usage: r.usage ?? { inputTokens: 100, outputTokens: 50, groundedRequests: req.grounded ? 1 : 0 },
      finishReason: r.finishReason ?? 'STOP',
      truncated: r.truncated ?? false,
      evidence: r.evidence,
    }
  },
}
