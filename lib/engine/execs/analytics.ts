import { db } from '@/lib/db'
import { repoFacts } from './facts'

// The team's daily analysis, done by code: what moved this week compared with
// last week, and — just as important — what didn't move at all.
//
// Every number here is counted from MarkOS's own records, the repos or what
// the founder entered. Models read this; they never produce it. A metric that
// can't be counted is absent, never estimated.

const DAY = 86400_000

export interface Trend {
  name: string
  thisWeek: number
  lastWeek: number
}

export interface FounderMetric {
  metric: string
  latest: number
  latestOn: string
  previous: number | null
  previousOn: string | null
}

export interface Stall {
  what: string
  days: number
}

export interface Analytics {
  productId: string | null
  trends: Trend[]
  founderMetrics: FounderMetric[]
  stalls: Stall[]
  waitingOnFounder: number
}

type Row = Record<string, unknown>

const ts = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN)
const inWindow = (v: unknown, from: number, to: number) => {
  const t = ts(v)
  return Number.isFinite(t) && t >= from && t < to
}
const daysSince = (v: unknown) => Math.floor((Date.now() - ts(v)) / DAY)

function trend(name: string, rows: Row[], field: string, filter: (r: Row) => boolean = () => true): Trend {
  const now = Date.now()
  const recent = rows.filter(filter)
  return {
    name,
    thisWeek: recent.filter(r => inWindow(r[field], now - 7 * DAY, now + 1)).length,
    lastWeek: recent.filter(r => inWindow(r[field], now - 14 * DAY, now - 7 * DAY)).length,
  }
}

export async function analyse(productId: string | null): Promise<Analytics> {
  const supabase = db()
  const since = new Date(Date.now() - 60 * DAY).toISOString()

  let contentQ = supabase.from('content_items').select('status, created_at, published_at, updated_at')
  let outreachQ = supabase.from('outreach_targets').select('status, created_at, sent_at')
  let pipelineQ = supabase.from('pipeline').select('stage, created_at, updated_at, last_contacted_at')
  let tasksQ = supabase.from('tasks').select('status, created_at, finished_at')
  let metricsQ = supabase.from('metric_entries').select('metric, value, recorded_for')
  let brainQ = supabase.from('product_brains').select('product_id, strategy_status, updated_at')
  let productsQ = supabase.from('products').select('id, name, repo_paths').eq('status', 'active')
  if (productId) {
    contentQ = contentQ.eq('product_id', productId)
    outreachQ = outreachQ.eq('product_id', productId)
    pipelineQ = pipelineQ.eq('product_id', productId)
    tasksQ = tasksQ.eq('product_id', productId)
    metricsQ = metricsQ.eq('product_id', productId)
    brainQ = brainQ.eq('product_id', productId)
    productsQ = productsQ.eq('id', productId)
  }
  const [content, outreach, pipeline, tasks, metrics, brains, products] = await Promise.all([
    contentQ.gte('created_at', since),
    outreachQ.gte('created_at', since),
    pipelineQ,
    tasksQ.gte('created_at', since),
    metricsQ.order('recorded_for', { ascending: false }).limit(200),
    brainQ,
    productsQ,
  ])
  const c = (content.data ?? []) as Row[]
  const o = (outreach.data ?? []) as Row[]
  const p = (pipeline.data ?? []) as Row[]
  const t = (tasks.data ?? []) as Row[]

  const trends: Trend[] = [
    trend('content drafted', c, 'created_at'),
    trend('posts published', c, 'published_at'),
    trend('outreach emails sent', o, 'sent_at'),
    trend('prospects found', p, 'created_at'),
    trend('prospects contacted', p, 'last_contacted_at'),
    trend('prospects moved to replied/meeting/won', p, 'updated_at', r => ['replied', 'meeting', 'won'].includes(String(r.stage))),
    trend('tasks completed', t, 'finished_at', r => r.status === 'done'),
    trend('tasks failed', t, 'finished_at', r => r.status === 'failed'),
  ]

  // Shipping velocity, straight from git.
  for (const prod of (products.data ?? []) as Array<{ name: string; repo_paths: string[] }>) {
    for (const path of prod.repo_paths ?? []) {
      const [week, twoWeeks] = await Promise.all([
        repoFacts(path, new Date(Date.now() - 7 * DAY)),
        repoFacts(path, new Date(Date.now() - 14 * DAY)),
      ])
      if (!week.isGit) continue
      trends.push({
        name: `commits · ${productId ? path.split('/').pop() : prod.name}`,
        thisWeek: week.commitsSince.length,
        lastWeek: twoWeeks.commitsSince.length - week.commitsSince.length,
      })
    }
  }

  // The founder's own numbers: latest vs previous entry, per metric.
  const byMetric = new Map<string, Array<{ value: number; on: string }>>()
  for (const m of (metrics.data ?? []) as Row[]) {
    const key = String(m.metric)
    byMetric.set(key, [...(byMetric.get(key) ?? []), { value: Number(m.value), on: String(m.recorded_for) }])
  }
  const founderMetrics: FounderMetric[] = [...byMetric.entries()].map(([metric, rows]) => ({
    metric,
    latest: rows[0].value,
    latestOn: rows[0].on,
    previous: rows[1]?.value ?? null,
    previousOn: rows[1]?.on ?? null,
  }))

  // What isn't happening.
  const stalls: Stall[] = []
  const drafts = c.filter(r => r.status === 'draft')
  const oldestDraft = drafts.map(r => daysSince(r.created_at)).sort((a, b) => b - a)[0]
  if (oldestDraft >= 3) stalls.push({ what: `${drafts.length} content drafts waiting for approval (oldest)`, days: oldestDraft })
  const lastPost = c.map(r => ts(r.published_at)).filter(Number.isFinite).sort((a, b) => b - a)[0]
  if (c.length && (!lastPost || Date.now() - lastPost > 7 * DAY)) {
    stalls.push({ what: 'nothing published', days: lastPost ? Math.floor((Date.now() - lastPost) / DAY) : 60 })
  }
  const followUps = p.filter(r => r.stage === 'contacted' && daysSince(r.last_contacted_at) >= 3)
  if (followUps.length) stalls.push({ what: `${followUps.length} prospects contacted with no reply recorded (oldest)`, days: Math.max(...followUps.map(r => daysSince(r.last_contacted_at))) })
  const unworked = p.filter(r => r.stage === 'identified' && daysSince(r.created_at) >= 5)
  if (unworked.length) stalls.push({ what: `${unworked.length} prospects found but never contacted (oldest)`, days: Math.max(...unworked.map(r => daysSince(r.created_at))) })
  for (const b of (brains.data ?? []) as Row[]) {
    if (b.strategy_status === 'draft' && daysSince(b.updated_at) >= 2) {
      const name = ((products.data ?? []) as Array<{ id: string; name: string }>).find(x => x.id === b.product_id)?.name
      stalls.push({ what: `strategy${productId ? '' : ` for ${name}`} waiting for approval`, days: daysSince(b.updated_at) })
    }
  }
  const lastMetric = founderMetrics.map(m => Date.parse(m.latestOn)).sort((a, b) => b - a)[0]
  if (!lastMetric || Date.now() - lastMetric > 7 * DAY) {
    stalls.push({ what: 'no business numbers entered by the founder', days: lastMetric ? Math.floor((Date.now() - lastMetric) / DAY) : 60 })
  }

  const waitingOnFounder = drafts.length + o.filter(r => r.status === 'identified').length +
    ((brains.data ?? []) as Row[]).filter(b => b.strategy_status === 'draft').length

  return { productId, trends, founderMetrics, stalls: stalls.sort((a, b) => b.days - a.days), waitingOnFounder }
}

const arrow = (a: number, b: number) => (a > b ? '↑' : a < b ? '↓' : '→')

export function renderAnalytics(a: Analytics): string {
  const lines = a.trends
    .filter(t => t.thisWeek || t.lastWeek)
    .map(t => `- ${t.name}: ${t.thisWeek} this week vs ${t.lastWeek} last week ${arrow(t.thisWeek, t.lastWeek)}`)
  const quiet = a.trends.filter(t => !t.thisWeek && !t.lastWeek).map(t => t.name)
  return [
    `This week vs last (counted by code):\n${lines.join('\n') || '- no activity in either week'}`,
    quiet.length ? `Zero in both weeks: ${quiet.join(', ')}` : null,
    a.founderMetrics.length
      ? `Founder's numbers:\n${a.founderMetrics.map(m => `- ${m.metric}: ${m.latest} on ${m.latestOn}${m.previous !== null ? ` (was ${m.previous} on ${m.previousOn}, ${arrow(m.latest, m.previous)})` : ''}`).join('\n')}`
      : 'Founder\'s numbers: none entered — revenue, users and traffic are unknown.',
    a.stalls.length ? `Not happening:\n${a.stalls.map(s => `- ${s.what} — ${s.days} days`).join('\n')}` : 'Not happening: nothing stalled.',
    `Items waiting on the founder: ${a.waitingOnFounder}`,
  ].filter(Boolean).join('\n')
}
