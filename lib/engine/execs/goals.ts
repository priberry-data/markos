import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { CHARTER } from '../charter'
import { EXEC_KEYS, GoalsDraftSchema } from '../schemas'
import { applyModelSettings, portfolio, renderPortfolio } from './context'
import { EXECS } from './roster'

// What the company is working toward. Every agent reads these before it
// works, the brief tracks them, and the Home page leads with them. The Chief
// of Staff drafts them from each product's own docs and numbers; only the
// founder makes them active.

export interface Goal {
  id: string
  product_id: string | null
  title: string
  metric: string | null
  current: number | null
  target: number | null
  unit: string | null
  due: string | null
  owner: string | null
  why: string | null
  status: 'proposed' | 'active' | 'achieved' | 'dropped'
}

export async function listGoals(statuses: Goal['status'][] = ['active', 'proposed']): Promise<Goal[]> {
  const { data } = await db().from('goals').select('*').in('status', statuses).order('product_id', { nullsFirst: true }).order('sort')
  return (data ?? []) as Goal[]
}

const progress = (g: Goal) =>
  g.target ? `${g.current ?? '?'} of ${g.target}${g.unit ? ` ${g.unit}` : ''}` : g.current !== null ? `${g.current}${g.unit ? ` ${g.unit}` : ''}` : 'not measured yet'

/** The goals, as every agent sees them. */
export async function renderGoals(productId: string | null = null): Promise<string> {
  const goals = await listGoals()
  if (goals.length === 0) return ''
  const { data: products } = await db().from('products').select('id, name')
  const name = new Map((products ?? []).map(p => [p.id as string, p.name as string]))
  const confirmed = goals.some(g => g.status === 'active')
  const shown = confirmed ? goals.filter(g => g.status === 'active') : goals
  const relevant = productId ? shown.filter(g => !g.product_id || g.product_id === productId) : shown
  return `## WHAT WE'RE WORKING TOWARD${confirmed ? '' : ' (proposed — the founder hasn’t confirmed these yet)'}
Every recommendation you make should move one of these. Say which.
${relevant.map(g => `- ${g.product_id ? name.get(g.product_id) ?? 'product' : 'COMPANY'}: ${g.title} — ${progress(g)}${g.due ? `, by ${g.due}` : ''}${g.owner ? ` (owner: ${EXECS[g.owner as keyof typeof EXECS]?.title ?? g.owner})` : ''}`).join('\n')}`
}

/** The Chief of Staff drafts goals from the products' own docs. They wait for the founder. */
export async function proposeGoals(signal?: AbortSignal): Promise<number> {
  await applyModelSettings()
  const supabase = db()
  const products = await portfolio()
  const { data: intakes } = await supabase.from('products').select('id, name, intake').in('id', products.map(p => p.id))
  const docs = (intakes ?? []).map(p => {
    const i = p.intake as { goals?: string[]; stage?: string; unknowns?: string[] } | null
    return `### ${p.name}\nStage: ${i?.stage ?? 'unknown'}\nGoals the product's own docs state:\n${(i?.goals ?? []).map(g => `- ${g}`).join('\n') || '- none stated'}`
  }).join('\n\n')

  const { data } = await generateObject({ agent: 'chief_of_staff', signal }, {
    system: `${CHARTER}\n\nYou are the Chief of Staff drafting the company's goals for the founder to confirm. Good goals are few, measurable, dated, owned, and come from the founder's own plans — not invented ambition.\nTHE TEAM: ${EXEC_KEYS.filter(k => k !== 'ea').map(k => `${k} (${EXECS[k].title})`).join(', ')}`,
    prompt: `PRODUCTS:\n${renderPortfolio(products)}\n\n${docs}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Draft one company goal for this quarter and at most two goals per product, using the targets and dates the docs already state wherever they exist.`,
    schema: GoalsDraftSchema,
    purpose: 'goals',
  })

  // Replace earlier drafts; never touch goals the founder has already acted on.
  await supabase.from('goals').delete().eq('status', 'proposed')
  const byName = new Map(products.map(p => [p.name.toLowerCase(), p.id]))
  const rows = [
    { ...data.company, product_id: null, sort: 0 },
    ...data.products.flatMap(p => p.goals.slice(0, 2).map((g, i) => ({ ...g, product_id: byName.get(p.product.toLowerCase()) ?? null, sort: i + 1 })))
      .filter(r => r.product_id),
  ].map(g => ({
    product_id: g.product_id, title: g.title, metric: g.metric, target: g.target, unit: g.unit,
    due: g.due && /^\d{4}-\d{2}-\d{2}$/.test(g.due) ? g.due : null, owner: g.owner, why: g.why,
    status: 'proposed', source: 'chief_of_staff', sort: g.sort,
  }))
  const { error } = await supabase.from('goals').insert(rows)
  if (error) throw new Error(`Could not save the goals: ${error.message}`)
  return rows.length
}
