import { db } from '@/lib/db'
import { ResearchSchema, StrategySchema, SearchSchema, PRSchema } from '@/lib/engine/schemas'

// Downloads: CSV for tables, Markdown for documents, and "all" as one
// Markdown file with everything the team has produced for the product.

function csv(rows: Record<string, unknown>[], columns: string[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\n')
}

function file(body: string, name: string, type: string) {
  return new Response(body, {
    headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${name}"` },
  })
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function contentMarkdown(productId: string) {
  const { data } = await db().from('content_items').select('*').eq('product_id', productId)
    .in('status', ['draft', 'approved', 'posted']).order('scheduled_at')
  return (data ?? []).map(p => [
    `### ${p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : 'Unscheduled'} · ${p.platform} · ${p.status}`,
    p.title ? `**${p.title}**` : '',
    p.body ?? '',
    (p.hashtags ?? []).length ? (p.hashtags as string[]).join(' ') : '',
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n')
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params
  const url = new URL(req.url)
  const productId = url.searchParams.get('productId')
  const format = url.searchParams.get('format') ?? 'md'
  if (!productId) return new Response('productId is required', { status: 400 })

  const supabase = db()
  const { data: product } = await supabase.from('products').select('name').eq('id', productId).single()
  if (!product) return new Response('Not found', { status: 404 })
  const base = slug(product.name)

  if (kind === 'content') {
    if (format === 'csv') {
      const { data } = await supabase.from('content_items').select('*').eq('product_id', productId).in('status', ['draft', 'approved', 'posted']).order('scheduled_at')
      return file(csv(data ?? [], ['scheduled_at', 'platform', 'status', 'title', 'body', 'hashtags', 'cta', 'goal']), `${base}-content.csv`, 'text/csv')
    }
    return file(`# ${product.name} — content\n\n${await contentMarkdown(productId)}\n`, `${base}-content.md`, 'text/markdown')
  }

  if (kind === 'distribution') {
    const { data } = await supabase.from('outreach_targets').select('*').eq('product_id', productId).neq('status', 'superseded').order('created_at')
    return file(csv(data ?? [], ['type', 'name', 'platform', 'url', 'audience_size', 'verified', 'source', 'handle_or_email', 'status', 'why_good_fit', 'draft_subject', 'outreach_draft']), `${base}-distribution.csv`, 'text/csv')
  }

  if (kind === 'search') {
    const { data } = await supabase.from('seo_data').select('*').eq('product_id', productId).eq('status', 'current')
    return file(csv(data ?? [], ['theme', 'intent', 'keyword', 'search_volume', 'difficulty', 'source']), `${base}-keywords.csv`, 'text/csv')
  }

  if (kind === 'all') {
    const [{ data: brain }, { data: outputs }] = await Promise.all([
      supabase.from('product_brains').select('research, strategy, strategy_status').eq('product_id', productId).maybeSingle(),
      supabase.from('agent_outputs').select('agent_name, content_json').eq('product_id', productId).eq('status', 'current'),
    ])
    const out = (a: string) => outputs?.find(o => o.agent_name === a)?.content_json
    const parts = [`# ${product.name} — marketing\n\nExported ${new Date().toLocaleString()}`]
    const s = brain?.strategy ? StrategySchema.safeParse(brain.strategy) : null
    if (s?.success) {
      const x = s.data
      parts.push(`## Strategy (${brain!.strategy_status})\n\n**Positioning:** ${x.positioning_statement}\n\n**Tagline:** ${x.tagline}\n\n**Hero move:** ${x.hero_move.title} — ${x.hero_move.description}\n\n**Voice:** ${x.voice.tone.join(', ')}\n\nDo:\n${x.voice.do.map(d => `- ${d}`).join('\n')}\n\nDon't:\n${x.voice.dont.map(d => `- ${d}`).join('\n')}\n\n**Channels:**\n${x.channels.map(c => `- ${c.channel} (${c.priority}): ${c.why}`).join('\n')}\n\n**90-day plan:**\n${x.plan.map(p => `- ${p.weeks} — ${p.theme}\n${p.weekly_goals.map(g => `  - Week ${g.week}: ${g.goal}`).join('\n')}`).join('\n')}`)
    }
    const r = brain?.research ? ResearchSchema.safeParse(brain.research) : null
    if (r?.success) {
      parts.push(`## Research\n\n${r.data.market.summary}\n\n**Competitors:**\n${r.data.competitors.map(c => `- ${c.name}: ${c.positioning}${c.source ? ` (${c.source})` : ''}`).join('\n')}\n\n**Pain points:**\n${r.data.audience.pain_points.map(p => `- ${p.point}${p.source ? ` (${p.source})` : ''}`).join('\n')}`)
    }
    const q = SearchSchema.safeParse(out('search'))
    if (q.success) parts.push(`## Articles to write\n\n${q.data.articles.map(a => `- **${a.title}** — targets "${a.target_keyword}"`).join('\n')}`)
    const pr = PRSchema.safeParse(out('pr'))
    if (pr.success) parts.push(`## Press release\n\n# ${pr.data.press_release.headline}\n\n${pr.data.press_release.subhead}\n\n${pr.data.press_release.body}`)
    parts.push(`## Content\n\n${await contentMarkdown(productId)}`)
    return file(parts.join('\n\n---\n\n') + '\n', `${base}-marketing.md`, 'text/markdown')
  }

  return new Response('Unknown export', { status: 404 })
}
