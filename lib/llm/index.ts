import { z } from 'zod'
import { aiLimiter } from './limiter'
import { costUsd } from './pricing'
import { describeIssues, extractJson, toProviderSchema } from './schema'
import { AGENTS, AgentKey, modelFor, shapeModelFor } from './models'
import { claudeCode } from './providers/claude-code'
import { gemini } from './providers/gemini'
import { anthropic } from './providers/anthropic'
import { fake } from './providers/fake'
import {
  ModelRef, Provider, ProviderError, ProviderId, ProviderRequest, ProviderResponse, Source,
} from './types'

// The one way MarkOS calls an AI model.
//
// Every call gets: a concurrency cap, retries with backoff on transient errors,
// a single retry with more room if the reply was cut off, schema validation
// with one repair attempt, cancellation, cost accounting, a per-run budget, and
// a row in llm_calls. The old layer had none of the validation — every agent
// ran JSON.parse on free text, so a slightly different shape either crashed the
// whole launch or silently saved nothing.

export type { AgentKey } from './models'
export { ProviderError } from './types'

const PROVIDERS: Record<ProviderId, Provider> = { 'claude-code': claudeCode, gemini, anthropic, fake }

export class BudgetExceededError extends Error {
  constructor(readonly spentUsd: number, readonly budgetUsd: number) {
    super(`This run reached its budget ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}). Raise it in Settings to continue.`)
    this.name = 'BudgetExceededError'
  }
}

export class InvalidOutputError extends Error {
  constructor(message: string, readonly issues: string) {
    super(message)
    this.name = 'InvalidOutputError'
  }
}

/** Where a call belongs, for accounting and cancellation. */
export interface CallContext {
  agent: AgentKey
  runId?: string | null
  productId?: string | null
  signal?: AbortSignal
  /** Max spend for the whole run, in USD. Omit for no cap. */
  budgetUsd?: number
}

export interface CallRecord {
  run_id: string | null
  product_id: string | null
  agent: AgentKey
  purpose: string
  provider: ProviderId
  model: string
  input_tokens: number
  output_tokens: number
  grounded_requests: number
  cost_usd: number
  latency_ms: number
  status: 'ok' | 'error'
  error: string | null
}

// ── accounting (injectable so tests need no database) ───────────────────────

type Recorder = (row: CallRecord) => Promise<void>
type SpentLookup = (runId: string) => Promise<number>

const dbRecorder: Recorder = async row => {
  const { db } = await import('@/lib/db')
  const { error } = await db().from('llm_calls').insert(row)
  if (error) console.error('[markos] could not record AI call:', error.message)
}

const dbSpent: SpentLookup = async runId => {
  const { db } = await import('@/lib/db')
  const { data } = await db().from('llm_calls').select('cost_usd').eq('run_id', runId)
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0)
}

let record: Recorder = dbRecorder
let lookupSpent: SpentLookup = dbSpent
const spentByRun = new Map<string, number>()

/** Tests swap the database out for in-memory functions. */
export function configureAccounting(opts: { record?: Recorder; lookupSpent?: SpentLookup }) {
  if (opts.record) record = opts.record
  if (opts.lookupSpent) lookupSpent = opts.lookupSpent
  spentByRun.clear()
}

async function spentSoFar(runId: string): Promise<number> {
  if (!spentByRun.has(runId)) spentByRun.set(runId, await lookupSpent(runId))
  return spentByRun.get(runId)!
}

// ── the core call ───────────────────────────────────────────────────────────

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new ProviderError('Cancelled.', 'aborted'))
    }, { once: true })
  })

interface RawCall {
  ctx: CallContext
  model: ModelRef
  purpose: string
  request: Omit<ProviderRequest, 'model' | 'signal'>
}

async function callOnce({ ctx, model, purpose, request }: RawCall): Promise<ProviderResponse> {
  const provider = PROVIDERS[model.provider]
  if (!provider) throw new ProviderError(`Unknown AI provider "${model.provider}".`, 'not_configured')
  if (!provider.isConfigured()) {
    if (model.provider === 'claude-code') {
      throw new ProviderError('Claude Code is not installed. Run: curl -fsSL https://claude.ai/install.sh | bash — then `claude` and /login.', 'not_configured')
    }
    const envVar = model.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'
    throw new ProviderError(`${envVar} is not set. Add it to .env.local to use ${AGENTS[ctx.agent].name}.`, 'not_configured')
  }

  if (ctx.runId && ctx.budgetUsd !== undefined) {
    const spent = await spentSoFar(ctx.runId)
    if (spent >= ctx.budgetUsd) throw new BudgetExceededError(spent, ctx.budgetUsd)
  }

  const MAX_ATTEMPTS = 4
  for (let attempt = 1; ; attempt++) {
    if (ctx.signal?.aborted) throw new ProviderError('Cancelled.', 'aborted')
    const started = Date.now()
    try {
      const res = await aiLimiter.run(
        () => provider.call({ ...request, model: model.model, signal: ctx.signal }),
        ctx.signal,
      )
      const cost = res.costUsd ?? costUsd(model, res.usage)
      if (ctx.runId) spentByRun.set(ctx.runId, (spentByRun.get(ctx.runId) ?? 0) + cost)
      await record({
        run_id: ctx.runId ?? null,
        product_id: ctx.productId ?? null,
        agent: ctx.agent,
        purpose,
        provider: model.provider,
        model: model.model,
        input_tokens: res.usage.inputTokens,
        output_tokens: res.usage.outputTokens,
        grounded_requests: res.usage.groundedRequests,
        cost_usd: Number(cost.toFixed(6)),
        latency_ms: Date.now() - started,
        status: 'ok',
        error: null,
      })
      return res
    } catch (err) {
      const pe = err instanceof ProviderError ? err : new ProviderError(String(err), 'network')
      if (pe.kind === 'aborted') throw pe
      await record({
        run_id: ctx.runId ?? null,
        product_id: ctx.productId ?? null,
        agent: ctx.agent,
        purpose,
        provider: model.provider,
        model: model.model,
        input_tokens: 0,
        output_tokens: 0,
        grounded_requests: 0,
        cost_usd: 0,
        latency_ms: Date.now() - started,
        status: 'error',
        error: `${pe.kind}: ${pe.message}`.slice(0, 500),
      })
      if (!pe.transient || attempt >= MAX_ATTEMPTS) throw pe
      await sleep(1500 * 2 ** (attempt - 1), ctx.signal) // 1.5s, 3s, 6s
    }
  }
}

// ── public API ──────────────────────────────────────────────────────────────

export interface TextResult {
  text: string
  sources: Source[]
  model: ModelRef
  /** What the web tools returned verbatim, when the provider exposes it; else the answer text. */
  evidence: string
}

/**
 * Free-text generation. With `grounded: true` the model searches the live web
 * and the result carries the sources it used. An empty grounded reply is an
 * error, never "nothing exists".
 */
export async function generateText(
  ctx: CallContext,
  args: {
    system: string
    prompt: string
    grounded?: boolean
    maxOutputTokens?: number
    purpose?: string
    model?: ModelRef
    /** Local folders (a product's repo) the model may read. */
    readPaths?: string[]
  },
): Promise<TextResult> {
  const model = args.model ?? modelFor(ctx.agent)
  let maxOutputTokens = args.maxOutputTokens ?? 4096
  for (let widen = 0; ; widen++) {
    const res = await callOnce({
      ctx,
      model,
      purpose: args.purpose ?? (args.grounded ? 'research' : 'write'),
      request: {
        system: args.system,
        prompt: args.prompt,
        grounded: args.grounded,
        maxOutputTokens,
        reasoning: AGENTS[ctx.agent].reasoning,
        readPaths: args.readPaths,
      },
    })
    if (res.truncated && widen === 0) {
      maxOutputTokens *= 2
      continue
    }
    if (!res.text) {
      throw new ProviderError(
        args.grounded ? 'The web search returned no usable answer.' : 'The model returned an empty answer.',
        'empty',
      )
    }
    return { text: res.text, sources: res.sources, model, evidence: res.evidence ?? res.text }
  }
}

/**
 * Structured generation. The reply is constrained to the schema by the provider
 * and then validated with zod. If validation still fails, the model gets one
 * chance to repair its answer with the exact problems listed. Callers either
 * get data that matches the schema or a clear error — never a half-shape.
 */
export async function generateObject<T>(
  ctx: CallContext,
  args: {
    system: string
    prompt: string
    schema: z.ZodType<T>
    maxOutputTokens?: number
    purpose?: string
    /** 'shape' uses the cheap reshaping model for this agent's provider. */
    tier?: 'main' | 'shape'
    model?: ModelRef
    /** Local folders (a product's repo) the model may read. */
    readPaths?: string[]
  },
): Promise<{ data: T; model: ModelRef }> {
  const model = args.model ?? (args.tier === 'shape' ? shapeModelFor(ctx.agent) : modelFor(ctx.agent))
  const jsonSchema = toProviderSchema(args.schema)
  const reasoning = args.tier === 'shape' ? 'none' : AGENTS[ctx.agent].reasoning
  let maxOutputTokens = args.maxOutputTokens ?? 8192
  let prompt = args.prompt
  // Two independent allowances: one widening if the reply is cut off, and one
  // repair if it arrives complete but doesn't match the schema.
  let widened = false
  let repaired = false

  for (;;) {
    const res = await callOnce({
      ctx,
      model,
      purpose: args.purpose ?? 'structure',
      request: { system: args.system, prompt, jsonSchema, maxOutputTokens, reasoning, readPaths: args.readPaths },
    })

    if (res.truncated) {
      if (!widened) {
        widened = true
        maxOutputTokens *= 2
        continue
      }
      throw new InvalidOutputError('The answer was too long and got cut off, even with extra room.', 'truncated')
    }

    let parsed: unknown
    try {
      parsed = extractJson(res.text)
    } catch {
      parsed = undefined
    }
    const result = parsed === undefined ? null : args.schema.safeParse(parsed)
    if (result?.success) return { data: result.data, model }

    const issues = result ? describeIssues(result.error) : '- the reply was not valid JSON'
    if (repaired) {
      throw new InvalidOutputError(`${AGENTS[ctx.agent].name} returned output that doesn't match the expected format.`, issues)
    }
    repaired = true
    // One repair attempt, telling the model exactly what was wrong.
    prompt = `${args.prompt}

---
Your previous answer did not match the required format. Problems:
${issues}

Your previous answer (for reference):
${res.text.slice(0, 8000)}

Return the complete corrected answer as JSON only.`
  }
}

/**
 * Evidence first, structure second: a grounded web-search pass gathers facts
 * with their sources, then a separate schema-constrained pass turns them into
 * structured data. The two are separate calls because providers don't reliably
 * allow search tools and a fixed output schema in the same request.
 */
export async function researchThenShape<T>(
  ctx: CallContext,
  args: {
    system: string
    researchPrompt: string
    shapeInstructions: string
    schema: z.ZodType<T>
    researchTokens?: number
    shapeTokens?: number
  },
): Promise<{ data: T; sources: Source[]; notes: string; evidence: string }> {
  const research = await generateText(ctx, {
    system: args.system,
    prompt: args.researchPrompt,
    grounded: true,
    maxOutputTokens: args.researchTokens ?? 6000,
    purpose: 'research',
  })

  const sourceList = research.sources.length
    ? research.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')
    : '(no sources were returned)'

  const { data } = await generateObject(ctx, {
    system: args.system,
    prompt: `${args.shapeInstructions}

RESEARCH NOTES (gathered from a live web search just now; a marker like [3]
after a sentence means it came from source 3):
${research.text}

SOURCES (when you cite, copy the URL exactly from this list — never invent a URL):
${sourceList}`,
    schema: args.schema,
    maxOutputTokens: args.shapeTokens ?? 8192,
    purpose: 'shape',
    tier: 'shape',
  })

  const seen = new Set<string>()
  const sources = research.sources.filter(s => s.url && (seen.has(s.url) ? false : (seen.add(s.url), true)))
  return { data, sources, notes: research.text, evidence: research.evidence }
}

/** Is any provider usable right now? For friendly setup messages in the UI. */
export function configuredProviders(): ProviderId[] {
  return (['claude-code', 'gemini', 'anthropic'] as const).filter(p => PROVIDERS[p].isConfigured())
}
