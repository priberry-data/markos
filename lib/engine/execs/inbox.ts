import { db } from '@/lib/db'
import type { MorningBrief } from '../schemas'

// Everything waiting for the founder, across every product, in one list —
// ordered by what unblocks the most. Each item says what it is, why it
// matters and where to act on it.

export interface InboxItem {
  key: string
  kind: 'goals' | 'decision' | 'profile' | 'strategy' | 'posts' | 'outreach' | 'pitches' | 'customer_emails' | 'todo' | 'bug' | 'setup'
  title: string
  detail: string
  product: { id: string; name: string } | null
  count: number
  href: string
}

export async function inboxItems(): Promise<InboxItem[]> {
  const supabase = db()
  const [{ data: products }, { data: night }, { data: brains }, { data: drafts }, { data: outreach }, { data: pitches }, { data: custs }, { data: todos }, { data: bugs }] = await Promise.all([
    supabase.from('products').select('id, name, intake_status').eq('status', 'active').order('created_at'),
    supabase.from('nights').select('brief').not('brief', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('product_brains').select('product_id, strategy_status'),
    supabase.from('content_items').select('product_id').eq('status', 'draft'),
    supabase.from('outreach_targets').select('product_id').eq('status', 'identified'),
    supabase.from('pipeline').select('product_id').eq('stage', 'identified').not('pitch_body', 'is', null),
    supabase.from('customers').select('product_id').not('draft_body', 'is', null),
    supabase.from('tasks').select('id, task, due, product_id').eq('exec', 'founder').eq('status', 'queued').order('due', { nullsFirst: false }),
    supabase.from('issues').select('product_id').eq('status', 'open').in('severity', ['critical', 'high']),
  ])
  const ps = products ?? []
  const byId = new Map(ps.map(p => [p.id as string, { id: p.id as string, name: p.name as string }]))
  const count = (rows: Array<{ product_id: unknown }> | null, id: string) => (rows ?? []).filter(r => r.product_id === id).length
  const items: InboxItem[] = []

  const brief = night?.brief as MorningBrief | null
  for (const [i, d] of (brief?.top_decisions ?? []).entries()) {
    const p = d.product ? ps.find(x => x.name === d.product) : null
    items.push({ key: `decision-${i}`, kind: 'decision', title: d.question, detail: `Recommended: ${d.recommendation}`, product: p ? byId.get(p.id as string)! : null, count: 1, href: '/room' })
  }
  for (const t of todos ?? []) {
    items.push({ key: `todo-${t.id}`, kind: 'todo', title: t.task as string, detail: t.due ? `Due ${t.due}` : 'Your action item', product: t.product_id ? byId.get(t.product_id as string) ?? null : null, count: 1, href: '/meetings' })
  }
  for (const p of ps) {
    const prod = byId.get(p.id as string)!
    if (p.intake_status === 'draft') items.push({ key: `profile-${p.id}`, kind: 'profile', title: 'Confirm what the team read about this product', detail: 'Its profile is a draft until you confirm it', product: prod, count: 1, href: '/portfolio' })
    if ((brains ?? []).some(b => b.product_id === p.id && b.strategy_status === 'draft')) items.push({ key: `strategy-${p.id}`, kind: 'strategy', title: 'Approve the marketing strategy', detail: 'Nothing gets written until you approve it', product: prod, count: 1, href: '/strategy' })
    const n = {
      posts: count(drafts, p.id as string), outreach: count(outreach, p.id as string), pitches: count(pitches, p.id as string),
      customer_emails: count(custs, p.id as string), bug: count(bugs, p.id as string),
    }
    if (n.posts) items.push({ key: `posts-${p.id}`, kind: 'posts', title: `${n.posts} post${n.posts > 1 ? 's' : ''} to approve`, detail: 'Approving schedules them', product: prod, count: n.posts, href: '/approvals' })
    if (n.outreach) items.push({ key: `outreach-${p.id}`, kind: 'outreach', title: `${n.outreach} outreach message${n.outreach > 1 ? 's' : ''} to review`, detail: 'Communities, creators, publications', product: prod, count: n.outreach, href: '/distribution' })
    if (n.pitches) items.push({ key: `pitches-${p.id}`, kind: 'pitches', title: `${n.pitches} pitch${n.pitches > 1 ? 'es' : ''} ready to send`, detail: 'From Sales — each with a source', product: prod, count: n.pitches, href: '/pipeline' })
    if (n.customer_emails) items.push({ key: `cx-${p.id}`, kind: 'customer_emails', title: `${n.customer_emails} customer email${n.customer_emails > 1 ? 's' : ''} drafted`, detail: 'From the Customer team', product: prod, count: n.customer_emails, href: '/customers' })
    if (n.bug) items.push({ key: `bug-${p.id}`, kind: 'bug', title: `${n.bug} serious bug${n.bug > 1 ? 's' : ''} open`, detail: 'Found by QA or customers', product: prod, count: n.bug, href: '/quality' })
  }
  // Goals the team is waiting on, and the data connection that turns "unknown" into numbers.
  const { data: goalRows } = await supabase.from('goals').select('status').in('status', ['proposed', 'active'])
  if ((goalRows ?? []).length && !(goalRows ?? []).some(g => g.status === 'active')) {
    items.push({ key: 'goals', kind: 'goals', title: 'Confirm what the company is working toward', detail: `${goalRows!.length} goals drafted from your docs — edit, then confirm`, product: null, count: 1, href: '/goals' })
  }
  const { dataConnections } = await import('./data-team')
  const unconnected = (await dataConnections()).filter(c => !c.connected)
  if (unconnected.length === ps.length && ps.length > 0) {
    items.push({ key: 'data', kind: 'setup', title: 'Connect a product database for real numbers', detail: 'Read-only, 5 minutes — until then revenue, users and sign-ups stay “unknown”', product: null, count: 1, href: '/settings' })
  }

  const order: InboxItem['kind'][] = ['goals', 'decision', 'strategy', 'todo', 'profile', 'bug', 'setup', 'pitches', 'customer_emails', 'posts', 'outreach']
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}
