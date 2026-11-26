import type { ModelRef, ProviderId } from './types'

// Which model each agent uses. Claude Code by default: it runs on the
// founder's own Claude subscription, so there is no API key and no per-call
// bill, and it brings web search and read-only access to the product repos.
// Any agent can be switched to Gemini or the Anthropic API in Settings.
//
// Resolution order: Settings override (profiles.agent_models) → env var
// MARKOS_MODEL_<AGENT> (e.g. "gemini:gemini-3.8-flash") → default below.

export type AgentKey =
  | 'research' | 'strategy' | 'content' | 'search' | 'distribution' | 'creative'
  | 'pr' | 'ads' | 'investor' | 'review' | 'director' | 'assistant'
  // the executive team
  | 'chief_of_staff' | 'cmo' | 'cfo' | 'cpo' | 'cto' | 'sales' | 'coo' | 'intake'
  // the founder's office and the teams under the execs
  | 'ea' | 'qa' | 'cx' | 'data' | 'platform'

export type Reasoning = 'none' | 'light' | 'deep'

export interface AgentProfile {
  key: AgentKey
  name: string
  title: string
  description: string
  /** How much the model should think before answering. */
  reasoning: Reasoning
  model: ModelRef
}

// Current Gemini models (checked against ai.google.dev/gemini-api/docs/models,
// September 2026). The 2.5 series is legacy — access is limited to keys that
// already used it, so a new key would fail on those ids.
export const GEMINI_FLASH = 'gemini-3.8-flash'
export const GEMINI_FLASH_LITE = 'gemini-3.5-flash-lite'
export const GEMINI_FLASH_LITE_CHEAP = 'gemini-3.1-flash-lite'

// Claude Code takes model aliases, which always point at the latest release.
const sonnet: ModelRef = { provider: 'claude-code', model: 'sonnet' }
const opus: ModelRef = { provider: 'claude-code', model: 'opus' }

export const AGENTS: Record<AgentKey, AgentProfile> = {
  research:     { key: 'research', name: 'REX', title: 'Market Research', reasoning: 'light', model: sonnet,
                  description: 'Reads your site and searches the live web for your market, competitors, pricing and where your audience talks.' },
  strategy:     { key: 'strategy', name: 'SAGE', title: 'Strategy', reasoning: 'deep', model: opus,
                  description: 'Positioning, audience, voice, channels and a 90-day plan — paused for your approval.' },
  content:      { key: 'content', name: 'NOVA', title: 'Content', reasoning: 'light', model: sonnet,
                  description: 'A dated content calendar with ready-to-post copy for each channel.' },
  search:       { key: 'search', name: 'QUINN', title: 'Search & AI visibility', reasoning: 'light', model: sonnet,
                  description: 'Keywords, questions people ask, and how to show up in Google and AI answers.' },
  distribution: { key: 'distribution', name: 'REACH', title: 'Distribution', reasoning: 'light', model: sonnet,
                  description: 'Real communities, creators, publications and podcasts — each with a source link — plus outreach drafts.' },
  creative:     { key: 'creative', name: 'PIXEL', title: 'Creative', reasoning: 'light', model: sonnet,
                  description: 'A visual system from your real brand colours, and image prompts for your posts.' },
  pr:           { key: 'pr', name: 'ECHO', title: 'PR & Launch', reasoning: 'light', model: sonnet,
                  description: 'Launch narrative, press release and story angles. Runs when you are announcing a launch.' },
  ads:          { key: 'ads', name: 'MAX', title: 'Paid Ads', reasoning: 'light', model: sonnet,
                  description: 'Ad campaign drafts sized to your real budget and currency. Runs when you have an ad budget.' },
  investor:     { key: 'investor', name: 'IVY', title: 'Fundraising', reasoning: 'light', model: sonnet,
                  description: 'Sourced investor targets and narrative. Runs when you are raising.' },
  review:       { key: 'review', name: 'PULSE', title: 'Weekly Review', reasoning: 'deep', model: sonnet,
                  description: 'Reviews what actually happened and proposes strategy changes for you to approve.' },
  director:     { key: 'director', name: 'ARIA', title: 'Director', reasoning: 'light', model: sonnet,
                  description: 'Reviews every draft against your strategy and voice, and sends back what needs fixing.' },
  assistant:    { key: 'assistant', name: 'LYRA', title: 'Assistant', reasoning: 'light', model: sonnet,
                  description: 'Ask anything, refine any item, or run any agent.' },
  // ── the executive team ──
  chief_of_staff: { key: 'chief_of_staff', name: 'Chief of Staff', title: 'Chief of Staff', reasoning: 'deep', model: opus,
                  description: 'Routes your instructions to the right exec and writes the morning brief.' },
  cmo:          { key: 'cmo', name: 'CMO', title: 'Marketing', reasoning: 'light', model: sonnet,
                  description: 'Runs the marketing team for each product and reports what it produced.' },
  cfo:          { key: 'cfo', name: 'CFO', title: 'Finance', reasoning: 'deep', model: sonnet,
                  description: 'Pricing, unit economics and runway — from your code and the numbers you enter. Never invents revenue.' },
  cpo:          { key: 'cpo', name: 'CPO', title: 'Product', reasoning: 'light', model: sonnet,
                  description: 'What shipped, what is worth announcing, and where marketing promises more than the product does.' },
  cto:          { key: 'cto', name: 'CTO', title: 'Engineering', reasoning: 'light', model: sonnet,
                  description: 'Repo health: unfinished work, pending migrations, risks — read-only.' },
  sales:        { key: 'sales', name: 'Sales', title: 'Sales & Partnerships', reasoning: 'light', model: sonnet,
                  description: 'Finds companies, colleges and partners worth approaching — each with a source — and drafts the pitch.' },
  coo:          { key: 'coo', name: 'COO', title: 'Operations', reasoning: 'light', model: sonnet,
                  description: 'One calendar across products: what is due, what is stuck, what is waiting on you.' },
  ea:           { key: 'ea', name: 'Myra', title: 'Executive Assistant', reasoning: 'light', model: sonnet,
                  description: 'Runs your calendar: books meetings with the team when they need you, writes agendas and minutes, chases follow-ups.' },
  qa:           { key: 'qa', name: 'QA', title: 'Quality', reasoning: 'light', model: sonnet,
                  description: 'Checks your live products and repos for errors and bugs, and files them. Reports to the CTO.' },
  cx:           { key: 'cx', name: 'Customer', title: 'Customer team', reasoning: 'light', model: sonnet,
                  description: 'Talks to customers — drafts check-ins and interview invites you approve — and turns what they say into fixes and ideas. Reports to the COO.' },
  data:         { key: 'data', name: 'Data', title: 'Head of Data', reasoning: 'light', model: sonnet,
                  description: 'Reads your product databases (read-only), cleans and analyses the data, and turns unknowns into real numbers.' },
  platform:     { key: 'platform', name: 'Platform', title: 'Platform team', reasoning: 'light', model: sonnet,
                  description: 'Inspects MarkOS itself — failures, errors, wasted effort — and proposes fixes. Reports to the CTO.' },
  intake:       { key: 'intake', name: 'Intake', title: 'Product intake', reasoning: 'light', model: sonnet,
                  description: 'Reads a product’s repo and docs and drafts its profile for you to confirm.' },
}

export const AGENT_KEYS = Object.keys(AGENTS) as AgentKey[]

/** Cheap models for reshaping gathered text into a fixed structure, per provider. */
export const SHAPE_MODEL: ModelRef = { provider: 'gemini', model: GEMINI_FLASH_LITE }
export const CLAUDE_CODE_SHAPE_MODEL: ModelRef = { provider: 'claude-code', model: 'haiku' }

/** Models offered in Settings. */
export const MODEL_CHOICES: Array<{ ref: ModelRef; label: string; note: string }> = [
  { ref: sonnet, label: 'Claude Sonnet (Claude Code)', note: 'Default. On your Claude plan — no API key, web search and repo reading.' },
  { ref: opus, label: 'Claude Opus (Claude Code)', note: 'Deepest thinking. Uses your plan’s limits faster.' },
  { ref: { provider: 'claude-code', model: 'haiku' }, label: 'Claude Haiku (Claude Code)', note: 'Fastest and lightest on your limits. Fine for simple work.' },
  { ref: { provider: 'gemini', model: GEMINI_FLASH }, label: 'Gemini 3.8 Flash', note: 'Needs GEMINI_API_KEY. Cheap, with live Google Search.' },
  { ref: { provider: 'gemini', model: GEMINI_FLASH_LITE }, label: 'Gemini 3.5 Flash-Lite', note: 'Cheaper. Used for reshaping text into a fixed format.' },
  { ref: { provider: 'gemini', model: GEMINI_FLASH_LITE_CHEAP }, label: 'Gemini 3.1 Flash-Lite', note: 'Cheapest. Fine for simple work.' },
  { ref: { provider: 'anthropic', model: 'claude-sonnet-5' }, label: 'Claude Sonnet 5 (Anthropic API)', note: 'Billed per call. Needs ANTHROPIC_API_KEY with credit.' },
  { ref: { provider: 'anthropic', model: 'claude-opus-5-5' }, label: 'Claude Opus 5.5 (Anthropic API)', note: 'Billed per call, highest cost.' },
]

export function refToString(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`
}

export function parseRef(value: unknown): ModelRef | null {
  if (typeof value !== 'string') return null
  const [provider, ...rest] = value.split(':')
  const model = rest.join(':')
  if (!model || !['claude-code', 'gemini', 'anthropic', 'fake'].includes(provider)) return null
  return { provider: provider as ProviderId, model }
}

// Set once per run from profiles.agent_models. MarkOS is single-user, so a
// module-level value is enough.
let overrides: Partial<Record<AgentKey, string>> = {}

export function setModelOverrides(next: Partial<Record<AgentKey, string>> | null | undefined) {
  overrides = next ?? {}
}

/**
 * Tests force one model for everything in their own process (tests/setup-env.ts)
 * — they never touch the founder's saved settings, so the live app is never
 * answered by a test's fake AI.
 */
function forced(): ModelRef | null {
  return parseRef(process.env.MARKOS_FORCE_MODEL)
}

export function modelFor(agent: AgentKey): ModelRef {
  return (
    forced() ??
    parseRef(overrides[agent]) ??
    parseRef(process.env[`MARKOS_MODEL_${agent.toUpperCase()}`]) ??
    parseRef(process.env.MARKOS_MODEL_DEFAULT) ??
    AGENTS[agent].model
  )
}

/**
 * The model used to reshape text into a schema. Stays on the agent's own
 * provider so a Claude-only setup never needs a Gemini key, and vice versa.
 */
export function shapeModelFor(agent: AgentKey): ModelRef {
  const f = forced()
  if (f) return f
  const main = modelFor(agent)
  if (main.provider === 'claude-code') return CLAUDE_CODE_SHAPE_MODEL
  if (main.provider === 'gemini') return SHAPE_MODEL
  if (main.provider === 'anthropic') return { provider: 'anthropic', model: 'claude-haiku-4-5' }
  return main
}
