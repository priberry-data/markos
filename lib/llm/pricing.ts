import type { ModelRef, Usage } from './types'

// Published list prices in USD. Used to show what each run cost and to enforce
// the per-run budget. If a provider changes its prices, update them here — the
// token counts recorded in llm_calls are exact, only this table is an estimate.
//
// Checked against ai.google.dev/pricing and anthropic.com/pricing in September
// 2026. Prices change: if the figures shown in the app drift from your bill,
// update this table. Note Gemini 3.8 Flash is at promotional pricing until
// 31 Dec 2026 (it doubles on 1 Jan 2027).
interface Price {
  inputPerM: number
  outputPerM: number
  /** Charge per grounded (web-searched) request, if any. */
  perGroundedRequest?: number
}

// Grounded search on Gemini 3.x: 5,000 free requests a month, then $14 per
// 1,000. Charged here at the paid rate from the first request, so estimates
// err high rather than low.
const GEMINI_3_SEARCH = 0.014

const PRICES: Record<string, Price> = {
  // Google Gemini (ai.google.dev/pricing, September 2026)
  'gemini-3.8-flash': { inputPerM: 0.75, outputPerM: 3.75, perGroundedRequest: GEMINI_3_SEARCH },
  'gemini-3.7-flash': { inputPerM: 0.75, outputPerM: 3.75, perGroundedRequest: GEMINI_3_SEARCH },
  'gemini-3.6-flash': { inputPerM: 0.75, outputPerM: 3.75, perGroundedRequest: GEMINI_3_SEARCH },
  'gemini-3.5-flash-lite': { inputPerM: 0.3, outputPerM: 2.5, perGroundedRequest: GEMINI_3_SEARCH },
  'gemini-3.1-flash-lite': { inputPerM: 0.25, outputPerM: 1.5, perGroundedRequest: GEMINI_3_SEARCH },
  'gemini-3.1-pro': { inputPerM: 2, outputPerM: 12, perGroundedRequest: GEMINI_3_SEARCH },
  // Legacy 2.5 series: only usable by keys that already had access.
  'gemini-2.5-flash-lite': { inputPerM: 0.1, outputPerM: 0.4, perGroundedRequest: 0.035 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5, perGroundedRequest: 0.035 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10, perGroundedRequest: 0.035 },
  // Anthropic Claude
  'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
  'claude-haiku-4-5-20251001': { inputPerM: 1, outputPerM: 5 },
  // Claude web search is billed per search.
  'claude-sonnet-5': { inputPerM: 2, outputPerM: 10, perGroundedRequest: 0.01 },
  'claude-opus-5-5': { inputPerM: 5, outputPerM: 25, perGroundedRequest: 0.01 },
  // Tests
  fake: { inputPerM: 0, outputPerM: 0 },
}

function priceFor(model: string): Price | null {
  if (PRICES[model]) return PRICES[model]
  // Newer releases of a known family: price like the family.
  const family = Object.keys(PRICES).find(k => model.startsWith(k))
  return family ? PRICES[family] : null
}

export function costUsd(model: ModelRef, usage: Usage): number {
  const p = priceFor(model.model)
  if (!p) return 0
  return (
    (usage.inputTokens / 1_000_000) * p.inputPerM +
    (usage.outputTokens / 1_000_000) * p.outputPerM +
    usage.groundedRequests * (p.perGroundedRequest ?? 0)
  )
}

export function hasPrice(model: string): boolean {
  return priceFor(model) !== null
}
