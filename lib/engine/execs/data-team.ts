import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { DataFindingsSchema, DataPlanSchema, type DataFindings } from '../schemas'
import { applyModelSettings } from './context'
import { dataEnvVar, dataUrlFor, describeSchema, renderRows, runReadOnly, type QueryResult } from './data'
import { systemFor } from './roster'

// The Data team at work: plan queries from the product's real schema, run
// them read-only, repair the ones that failed (once), then analyse. Any number
// it reports must literally appear in the results — otherwise it's blanked.

export interface DataAnswer extends DataFindings {
  queries: QueryResult[]
  connected: boolean
}

/** Every number that appears in the results, as strings in a few common forms. */
function numbersIn(results: QueryResult[]): Set<string> {
  const out = new Set<string>()
  for (const r of results) for (const row of r.rows) for (const v of Object.values(row)) {
    const n = typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
    if (Number.isFinite(n)) { out.add(String(n)); out.add(n.toFixed(2)); out.add(String(Math.round(n))) }
  }
  return out
}

export async function analyseWithData(productId: string, question: string, signal?: AbortSignal): Promise<DataAnswer> {
  const { data: product } = await db().from('products').select('name').eq('id', productId).single()
  if (!product) throw new Error('Product not found')
  const url = dataUrlFor(product.name as string)
  if (!url) {
    return {
      connected: false, queries: [], metrics: [], findings: [], data_quality: [], caveats: [],
      answer: `${product.name}'s database isn't connected yet. Add a read-only connection as ${dataEnvVar(product.name as string)} in .env.local (Settings shows how).`,
    }
  }
  await applyModelSettings()
  const schema = await describeSchema(url)
  const ctx = { agent: 'data' as const, productId, signal }

  const plan = async (extra = '') => (await generateObject(ctx, {
    system: systemFor('data'),
    prompt: `Product: ${product.name}\n\nSCHEMA (the only tables and columns that exist):\n${schema}\n\nQUESTION:\n${question}\n${extra}\nWrite the queries that answer it. Today is ${new Date().toISOString().slice(0, 10)}. Prefer counts and grouped summaries over raw rows.`,
    schema: DataPlanSchema,
    purpose: 'data plan',
  })).data.queries.slice(0, 6)

  let results: QueryResult[] = []
  for (const q of await plan()) results.push(await runReadOnly(url, q.purpose, q.sql))
  const failed = results.filter(r => r.error)
  if (failed.length) {
    const fixes = await plan(`\nThese queries failed — fix them (only these):\n${failed.map(f => `- ${f.purpose}: ${f.sql}\n  ERROR: ${f.error}`).join('\n')}`)
    for (const q of fixes.slice(0, 3)) results.push(await runReadOnly(url, q.purpose, q.sql))
  }
  results = results.filter((r, i, all) => !r.error || !all.slice(i + 1).some(x => x.purpose === r.purpose && !x.error))

  const { data } = await generateObject(ctx, {
    system: systemFor('data'),
    prompt: `Product: ${product.name}\nQUESTION: ${question}\n\nQUERY RESULTS:\n${results.map(r => `### ${r.purpose}\n${r.sql}\n${renderRows(r)}`).join('\n\n')}\n\nAnswer from these results only.`,
    schema: DataFindingsSchema,
    purpose: 'data analysis',
  })

  // A number must come from the results — never from the model.
  const seen = numbersIn(results)
  const metrics = data.metrics.map(m => (m.value !== null && !seen.has(String(m.value)) && !seen.has(m.value.toFixed(2)) ? { ...m, value: null } : m))

  // Real numbers flow into everything else: analytics, reports, goals.
  const real = metrics.filter(m => m.value !== null)
  if (real.length) {
    const { error } = await db().from('metric_entries').insert(real.map(m => ({
      product_id: productId, metric: m.name, value: m.value, note: `Data team · ${m.basis}`,
    })))
    if (error) throw new Error(`Could not save the metrics: ${error.message}`)
  }
  return { ...data, metrics, queries: results, connected: true }
}

/** Which products have a data connection — for the Data team's facts and Settings. */
export async function dataConnections(): Promise<Array<{ id: string; name: string; envVar: string; connected: boolean }>> {
  const { data } = await db().from('products').select('id, name').eq('status', 'active').order('created_at')
  return (data ?? []).map(p => ({ id: p.id as string, name: p.name as string, envVar: dataEnvVar(p.name as string), connected: Boolean(dataUrlFor(p.name as string)) }))
}
