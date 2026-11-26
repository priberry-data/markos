import { db } from '@/lib/db'
import { CHARTER } from '../charter'
import { generateObject, generateText } from '@/lib/llm'
import { IntakeSchema, type Intake } from '../schemas'
import { applyModelSettings } from './context'
import { CHIEF_OF_STAFF_RULES } from './roster'

// Intake: the team learns a product from the product itself — its README,
// strategy docs, pricing code and brand CSS — instead of a form the founder
// fills in. The result is a draft. Where the repo contradicts itself it lists
// both values, and nothing reaches the agents until the founder confirms it.

const SYSTEM = `${CHARTER}

You are reading a product's own repository and documents to brief a marketing and executive team.
- Read the README, CLAUDE.md, docs about strategy, markets, growth, pricing and positioning, the pricing code, and the brand CSS or theme. Use Glob and Grep to find them; don't read the whole codebase.
- Report only what the files say. Where two files disagree, put both in conflicts — never choose.
- claims_rules: any rule the docs set about public language (e.g. words to avoid, claims not to make), phrased as an instruction.
- key_docs: list the paths you actually opened.
${CHIEF_OF_STAFF_RULES}`

export async function runIntake(productId: string, signal?: AbortSignal): Promise<Intake> {
  const supabase = db()
  await applyModelSettings()
  const { data: product, error } = await supabase.from('products').select('*').eq('id', productId).single()
  if (error || !product) throw new Error('Product not found')
  const paths = (product.repo_paths ?? []) as string[]
  const ctx = { agent: 'intake' as const, productId, signal }

  let notes = ''
  if (paths.length === 0) {
    // No code on this Mac: read the public site instead, and say so.
    const site = await generateText(ctx, {
      system: SYSTEM,
      prompt: `There is no code for "${product.name}" on this Mac. Fetch ${product.url} and search the web for it. Write notes on what it is, who it's for, pricing and brand — only what pages state.`,
      grounded: true,
      purpose: 'intake research',
    })
    notes = `NOTES FROM THE PUBLIC SITE (there is no repo on this Mac):\n${site.text}`
  }

  const { data } = await generateObject(ctx, {
    system: SYSTEM,
    prompt: `Product: ${product.name}${product.url ? ` (${product.url})` : ''}
${paths.length ? `Read its files under: ${paths.join(', ')}` : notes}
${product.description ? `The founder's own description: ${product.description}` : ''}

Draft the product profile.`,
    schema: IntakeSchema,
    purpose: 'intake',
    readPaths: paths,
  })

  const { error: saveError } = await supabase.from('products').update({ intake: data, intake_status: 'draft' }).eq('id', productId)
  if (saveError) throw new Error(`Could not save the intake: ${saveError.message}`)
  return data
}

/** The founder confirmed the intake (possibly edited): it becomes the product's profile and house rules. */
export async function confirmIntake(productId: string, edited?: Intake) {
  const supabase = db()
  const { data: product } = await supabase.from('products').select('intake, url').eq('id', productId).single()
  const intake = edited ?? (product?.intake as Intake | null)
  if (!intake) throw new Error('Nothing to confirm — run intake first')
  const parsed = IntakeSchema.parse(intake)

  const { error } = await supabase.from('products').update({
    description: [parsed.one_liner, parsed.description].filter(Boolean).join(' — '),
    url: product?.url || parsed.url || '',
    category: parsed.category,
    stage: parsed.stage,
    target_audience: parsed.target_audience,
    target_geography: parsed.target_geography,
    currency: parsed.currency,
    brand_voice: parsed.brand_voice,
    primary_color: parsed.primary_color,
    secondary_color: parsed.secondary_color,
    competitors: parsed.competitors.join(', ') || null,
    goals: parsed.goals,
    intake: parsed,
    intake_status: 'confirmed',
  }).eq('id', productId)
  if (error) throw new Error(`Could not save the product: ${error.message}`)

  if (parsed.claims_rules.length) {
    const { data: existing } = await supabase.from('house_rules').select('rule').eq('product_id', productId)
    const have = new Set((existing ?? []).map(r => (r.rule as string).toLowerCase()))
    const fresh = parsed.claims_rules.filter(r => !have.has(r.toLowerCase()))
    if (fresh.length) {
      const { error: rulesError } = await supabase.from('house_rules')
        .insert(fresh.map(rule => ({ product_id: productId, rule, origin: 'intake' })))
      if (rulesError) throw new Error(`Could not save house rules: ${rulesError.message}`)
    }
  }
}
