import { db } from '@/lib/db'
import type { Research, Strategy } from './schemas'

// The Product Brain: everything the agents know about one product, rendered as
// one compact brief.
//
// The old agents each assembled their own context: some got a pretty-printed
// dump of every upstream object (~9k tokens, five times over), PIXEL got 1,400
// characters of JSON cut mid-way, Content never saw pain points or voice rules,
// and the founder's brand voice and colours were never used at all. Now every
// agent reads the same brief, built here, in a stable order.

export interface ProductRow {
  id: string
  name: string
  url: string
  description: string | null
  category: string | null
  stage: string | null
  target_audience: string | null
  target_geography: string | null
  monthly_budget: string | null
  goals: string[] | null
  competitors: string | null
  already_tried: string | null
  brand_voice: string | null
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  currency: string | null
  ad_budget_monthly: number | string | null
  launch_date: string | null
  raising: boolean
  announcing_launch: boolean
  /** What intake read from the product's own files, including where they disagree. */
  intake?: {
    pricing_summary?: string | null
    claims_rules?: string[]
    offerings?: Array<{ name: string; what: string }>
    conflicts?: Array<{ topic: string; values: string[]; where: string }>
    unknowns?: string[]
  } | null
}

export interface Brain {
  product: ProductRow
  research: Research | null
  strategy: Strategy | null
  strategyStatus: 'none' | 'draft' | 'approved'
  rules: string[]
}

export async function loadBrain(productId: string): Promise<Brain> {
  const supabase = db()
  const [productRes, brainRes, rulesRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).single(),
    supabase.from('product_brains').select('*').eq('product_id', productId).maybeSingle(),
    supabase.from('house_rules').select('rule').eq('product_id', productId).eq('active', true).order('created_at'),
  ])
  if (productRes.error || !productRes.data) throw new Error('Product not found')

  return {
    product: productRes.data as ProductRow,
    research: (brainRes.data?.research as Research | null) ?? null,
    strategy: (brainRes.data?.strategy as Strategy | null) ?? null,
    strategyStatus: (brainRes.data?.strategy_status as Brain['strategyStatus']) ?? 'none',
    rules: (rulesRes.data ?? []).map(r => r.rule as string),
  }
}

const CURRENCY_BY_REGION: Array<[RegExp, string]> = [
  [/india|bharat/i, 'INR'],
  [/united states|^\s*us\s*$|\busa\b|\bu\.s\.|america/i, 'USD'],
  [/united kingdom|\buk\b|britain|england/i, 'GBP'],
  [/europe|\beu\b|germany|france|spain|italy|netherlands|ireland/i, 'EUR'],
  [/canada/i, 'CAD'],
  [/australia/i, 'AUD'],
  [/singapore/i, 'SGD'],
  [/uae|dubai|emirates/i, 'AED'],
]

/** The currency budgets and ads are expressed in. The old build forced INR everywhere. */
export function currencyFor(product: Pick<ProductRow, 'currency' | 'target_geography'>): string {
  if (product.currency) return product.currency.toUpperCase()
  const geo = product.target_geography ?? ''
  return CURRENCY_BY_REGION.find(([re]) => re.test(geo))?.[1] ?? 'USD'
}

export function adBudget(product: Pick<ProductRow, 'ad_budget_monthly'>): number {
  const n = Number(product.ad_budget_monthly ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const line = (label: string, value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    ? null
    : `${label}: ${Array.isArray(value) ? value.join(', ') : String(value)}`

const bullets = (items: string[] | undefined, max = 8) =>
  (items ?? []).slice(0, max).map(i => `- ${i}`).join('\n')

export interface BriefOptions {
  research?: boolean
  strategy?: boolean
  /** Include a strategy that hasn't been approved yet (only SAGE's own revisions need this). */
  draftStrategy?: boolean
}

/**
 * The brief every agent receives. Deterministic: the same brain always renders
 * to the same text, so it can be reused (and cached by providers) across calls.
 */
export function renderBrief(brain: Brain, opts: BriefOptions = { research: true, strategy: true }): string {
  const p = brain.product
  const parts: string[] = []

  parts.push(['## PRODUCT',
    line('Name', p.name),
    line('Website', p.url),
    line('What it is (founder)', p.description),
    line('Category', p.category),
    line('Stage', p.stage),
    line('Target audience (founder)', p.target_audience),
    line('Geography', p.target_geography),
    line('Currency', currencyFor(p)),
    line('Monthly ad budget', adBudget(p) > 0 ? `${adBudget(p)} ${currencyFor(p)}` : 'none — no paid ads'),
    line('Goals', p.goals),
    line('Launch date', p.launch_date),
    line('Currently raising', p.raising ? 'yes' : null),
    line('Announcing a launch', p.announcing_launch ? 'yes' : null),
    line('Competitors the founder knows', p.competitors),
    line('Already tried', p.already_tried),
    line('Brand voice (founder)', p.brand_voice),
    line('Brand colours', [p.primary_color, p.secondary_color].filter(Boolean).join(', ') || null),
    line('Pricing (from the product’s own files)', p.intake?.pricing_summary ?? null),
    p.intake?.offerings?.length ? `What's inside it:\n${bullets(p.intake.offerings.map(o => `${o.name}: ${o.what}`), 15)}` : null,
  ].filter(Boolean).join('\n'))

  // Where the product's own files disagree, nobody may pick a side: these are
  // open questions for the founder, and agents must not state either value.
  const conflicts = p.intake?.conflicts ?? []
  const unknowns = p.intake?.unknowns ?? []
  if (conflicts.length || unknowns.length) {
    parts.push(['## UNRESOLVED — never state these as fact',
      conflicts.length ? `The product's own files contradict each other on:\n${conflicts.map(c => `- ${c.topic}: ${c.values.join(' VS ')}`).join('\n')}` : null,
      unknowns.length ? `Not known (say so; never guess):\n${bullets(unknowns, 12)}` : null,
    ].filter(Boolean).join('\n'))
  }

  const r = brain.research
  if (opts.research && r) {
    parts.push(['## RESEARCH (live web, sourced)',
      `What it does: ${r.product.what_it_does}`,
      `Who it's for: ${r.product.who_its_for}`,
      r.product.key_features.length ? `Key features:\n${bullets(r.product.key_features, 10)}` : null,
      line('Pricing', r.product.pricing),
      r.product.proof_points.length ? `Proof points (from the site):\n${bullets(r.product.proof_points)}` : null,
      `Market: ${r.market.category} — ${r.market.summary}`,
      r.competitors.length
        ? `Competitors:\n${r.competitors.slice(0, 8).map(c => `- ${c.name}: ${c.positioning}${c.pricing ? ` (${c.pricing})` : ''}`).join('\n')}`
        : null,
      r.audience.pain_points.length ? `Audience pain points:\n${bullets(r.audience.pain_points.map(x => x.point))}` : null,
      r.audience.language_they_use.length ? `How they describe the problem: ${r.audience.language_they_use.slice(0, 10).map(x => `"${x}"`).join(', ')}` : null,
      r.audience.where_they_gather.length
        ? `Where they gather:\n${r.audience.where_they_gather.slice(0, 8).map(w => `- ${w.name} (${w.platform})`).join('\n')}`
        : null,
      r.questions_people_ask.length ? `Questions people ask:\n${bullets(r.questions_people_ask.map(q => q.question))}` : null,
      r.positioning_gaps.length ? `Positioning gaps:\n${bullets(r.positioning_gaps)}` : null,
      r.unknowns.length ? `Not confirmed by research (do not state as fact):\n${bullets(r.unknowns)}` : null,
    ].filter(Boolean).join('\n'))
  }

  const s = brain.strategy
  const strategyUsable = s && (brain.strategyStatus === 'approved' || opts.draftStrategy)
  if (opts.strategy && strategyUsable) {
    parts.push([`## STRATEGY (${brain.strategyStatus === 'approved' ? 'approved by the founder — follow it' : 'draft'})`,
      `Positioning: ${s.positioning_statement}`,
      `Tagline: ${s.tagline}`,
      `Unique value: ${s.unique_value}`,
      `Audience: ${s.audience.summary}`,
      s.audience.segments.length
        ? `Segments:\n${s.audience.segments.map(seg => `- ${seg.name}: ${seg.description} Pains: ${seg.pains.slice(0, 3).join('; ')}`).join('\n')}`
        : null,
      `Voice: ${s.voice.tone.join(', ')}`,
      s.voice.do.length ? `Voice — do:\n${bullets(s.voice.do)}` : null,
      s.voice.dont.length ? `Voice — don't:\n${bullets(s.voice.dont)}` : null,
      `Core message: ${s.messaging.core_message}`,
      s.messaging.pillars.length ? `Pillars:\n${s.messaging.pillars.map(pl => `- ${pl.title}: ${pl.message}`).join('\n')}` : null,
      s.channels.length ? `Channels:\n${s.channels.map(c => `- ${c.channel} (${c.priority}): ${c.why}`).join('\n')}` : null,
      `Hero move: ${s.hero_move.title} — ${s.hero_move.description}`,
      s.plan.length ? `Plan: ${s.plan.map(ph => `${ph.weeks} ${ph.theme}`).join(' → ')}` : null,
    ].filter(Boolean).join('\n'))
  }

  if (brain.rules.length) {
    parts.push(`## HOUSE RULES (learned from the founder — always follow)\n${bullets(brain.rules, 30)}`)
  }

  return parts.join('\n\n')
}
