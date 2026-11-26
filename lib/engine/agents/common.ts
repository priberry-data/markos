import { db } from '@/lib/db'
import { PLATFORMS, type Platform, type Strategy } from '../schemas'

/** Map the strategy's free-text channels onto the platforms NOVA writes for. */
export function platformsFromStrategy(strategy: Strategy | null, max = 4): Platform[] {
  const matchers: Array<[RegExp, Platform]> = [
    [/linked\s*in/i, 'linkedin'],
    [/twitter|\bx\b|x\.com/i, 'twitter'],
    [/insta/i, 'instagram'],
    [/reddit/i, 'reddit'],
    [/blog|seo|article|content marketing|medium|substack/i, 'blog'],
    [/e-?mail|newsletter/i, 'email'],
  ]
  const ranked = (strategy?.channels ?? [])
    .filter(c => c.priority !== 'later')
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'primary' ? -1 : 1))
  const out: Platform[] = []
  for (const c of ranked) {
    const hit = matchers.find(([re]) => re.test(c.channel))?.[1]
    if (hit && !out.includes(hit)) out.push(hit)
  }
  const fallback: Platform[] = ['linkedin', 'twitter', 'blog']
  for (const f of fallback) if (out.length < 2 && !out.includes(f)) out.push(f)
  return out.slice(0, max)
}

/** How many pieces a 30-day calendar should hold per platform. */
export const PIECES_PER_PLATFORM: Record<Platform, number> = {
  linkedin: 8, twitter: 12, instagram: 8, reddit: 4, blog: 3, email: 3,
}

export function isPlatform(v: string): v is Platform {
  return (PLATFORMS as readonly string[]).includes(v)
}

/**
 * A calendar slot as a real timestamp: day 1 is `start`, time is local HH:MM.
 * The old pipeline dropped day and time entirely, so the "30-day calendar" had
 * no dates at all.
 */
export function slotDate(start: Date, day: number, time: string): Date {
  const d = new Date(start)
  d.setDate(d.getDate() + Math.min(Math.max(Math.round(day), 1), 60) - 1)
  const m = time.match(/^(\d{1,2}):(\d{2})/)
  const hours = m ? Math.min(Number(m[1]), 23) : 9
  const minutes = m ? Math.min(Number(m[2]), 59) : 0
  d.setHours(hours, minutes, 0, 0)
  return d
}

/**
 * Before an agent re-writes its items, retire the old ones the founder never
 * touched. Approved, edited, scheduled, posted or contacted items are kept.
 * This replaces the old behaviour of appending a full duplicate set every run.
 */
export async function supersedeUntouched(table: 'content_items' | 'outreach_targets' | 'seo_data', productId: string) {
  const supabase = db()
  let res
  if (table === 'content_items') {
    // Only NOVA's own calendar pieces (they carry output_id). Drafts written for
    // a task the founder gave are theirs, and a calendar re-run never retires them.
    res = await supabase.from(table).update({ status: 'superseded' })
      .eq('product_id', productId).eq('edited', false).in('status', ['draft', 'pending_approval'])
      .not('output_id', 'is', null)
  } else if (table === 'outreach_targets') {
    res = await supabase.from(table).update({ status: 'superseded' })
      .eq('product_id', productId).in('status', ['identified', 'draft_ready'])
  } else {
    res = await supabase.from(table).update({ status: 'superseded' }).eq('product_id', productId).eq('status', 'current')
  }
  if (res.error) throw new Error(`Could not retire old ${table}: ${res.error.message}`)
}

/** Insert rows in batches; any failure is thrown, never swallowed. */
export async function insertRows(table: string, rows: Record<string, unknown>[], what: string) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db().from(table).insert(rows.slice(i, i + 100))
    if (error) throw new Error(`Could not save ${what}: ${error.message}`)
  }
}
