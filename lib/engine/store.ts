import { db } from '@/lib/db'
import type { Source } from '@/lib/llm/types'
import type { AgentKey } from '@/lib/llm/models'

// Persistence for the engine. Every write checks its error and throws — a step
// that could not save its output is a failed step, never a silent success.

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not save ${what}: ${res.error.message}`)
  return res.data
}

/**
 * Save an agent's output as the new current version for this product. The
 * previous current version is marked superseded — re-running an agent replaces
 * its output instead of piling up duplicates.
 */
export async function saveOutput(args: {
  runId: string | null
  productId: string
  agent: AgentKey
  outputType: string
  content: unknown
  sources?: Source[]
  status?: 'current' | 'draft'
}): Promise<{ id: string; version: number }> {
  const supabase = db()
  const { data: latest } = await supabase
    .from('agent_outputs')
    .select('version')
    .eq('product_id', args.productId)
    .eq('agent_name', args.agent)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (latest?.version ?? 0) + 1

  check(
    await supabase
      .from('agent_outputs')
      .update({ status: 'superseded' })
      .eq('product_id', args.productId)
      .eq('agent_name', args.agent)
      .in('status', ['current', 'draft', 'completed']),
    `${args.agent} history`,
  )

  const row = check(
    await supabase
      .from('agent_outputs')
      .insert({
        run_id: args.runId,
        product_id: args.productId,
        agent_name: args.agent,
        output_type: args.outputType,
        content_json: args.content,
        sources: args.sources ?? [],
        status: args.status ?? 'current',
        version,
      })
      .select('id')
      .single(),
    `${args.agent} output`,
  )
  return { id: (row as { id: string }).id, version }
}

/** Record the pages an agent actually retrieved. */
export async function recordSources(productId: string, agent: AgentKey, runId: string | null, sources: Source[]) {
  if (sources.length === 0) return
  const rows = sources.map(s => ({ product_id: productId, url: s.url, title: s.title, agent, run_id: runId }))
  check(
    await db().from('sources').upsert(rows, { onConflict: 'product_id,url', ignoreDuplicates: true }),
    'sources',
  )
}

/** Every source ever retrieved for this product — the allow-list for citations. */
export async function knownSources(productId: string): Promise<Source[]> {
  const { data } = await db().from('sources').select('url, title').eq('product_id', productId)
  return (data ?? []).map(r => ({ url: r.url as string, title: (r.title as string) ?? '' }))
}

// ── run steps ───────────────────────────────────────────────────────────────

type StepStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

const productOfRun = new Map<string, string>()

async function runProduct(runId: string): Promise<string | null> {
  if (!productOfRun.has(runId)) {
    const { data } = await db().from('agent_runs').select('product_id').eq('id', runId).single()
    if (data?.product_id) productOfRun.set(runId, data.product_id)
  }
  return productOfRun.get(runId) ?? null
}

export async function setStep(runId: string, agent: AgentKey, status: StepStatus, extra: { detail?: string | null; outputId?: string | null } = {}) {
  const now = new Date().toISOString()
  const row: Record<string, unknown> = { run_id: runId, product_id: await runProduct(runId), agent, status }
  if (extra.detail !== undefined) row.detail = extra.detail
  if (extra.outputId !== undefined) row.output_id = extra.outputId
  if (status === 'running') row.started_at = now
  if (status === 'done' || status === 'failed' || status === 'skipped') row.finished_at = now
  check(await db().from('run_steps').upsert(row, { onConflict: 'run_id,agent' }), `${agent} status`)
}

// ── runs ────────────────────────────────────────────────────────────────────

export type RunStatus =
  | 'running' | 'awaiting_approval' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled'

export async function updateRun(runId: string, fields: {
  status?: RunStatus
  phase?: string | null
  progress?: number
  error?: string | null
  warnings?: string[]
}) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (fields.status) update.status = fields.status
  if (fields.phase !== undefined) update.phase = fields.phase
  if (fields.progress !== undefined) update.progress_percent = fields.progress
  if (fields.error !== undefined) update.error_message = fields.error
  if (fields.warnings !== undefined) update.warnings = fields.warnings
  if (fields.status && ['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(fields.status)) {
    update.completed_at = new Date().toISOString()
  }
  let query = db().from('agent_runs').update(update).eq('id', runId)
  // A cancelled run stays cancelled — nothing may overwrite it with "completed".
  // (The old orchestrator's finalize step did exactly that.)
  if (fields.status && fields.status !== 'cancelled') query = query.neq('status', 'cancelled')
  check(await query, 'run status')
}

export async function notify(productId: string | null, n: { type: string; title: string; message: string; actionUrl?: string }) {
  const { error } = await db().from('notifications').insert({
    product_id: productId,
    type: n.type,
    title: n.title,
    message: n.message,
    action_url: n.actionUrl ?? null,
  })
  if (error) console.error('[markos] could not send notification:', error.message)
}
