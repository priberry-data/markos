import { db } from '@/lib/db'
import type { AgentKey } from '@/lib/llm/models'

export interface AgentStatus {
  lastRunAt: string | null
  version: number | null
  running: boolean
  lastStep: { status: string; detail: string | null } | null
  /** What this agent's most recent output cost, in USD (estimate). */
  lastCostUsd: number | null
}

/** Everything a page header needs to say about one agent. */
export async function agentStatus(productId: string, agent: AgentKey): Promise<AgentStatus> {
  const supabase = db()
  const [{ data: output }, { data: step }] = await Promise.all([
    supabase.from('agent_outputs').select('run_id, version, created_at').eq('product_id', productId).eq('agent_name', agent)
      .in('status', ['current', 'draft']).order('version', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('run_steps').select('status, detail, run_id, agent_runs!inner(product_id, started_at)')
      .eq('agent', agent).eq('agent_runs.product_id', productId)
      .order('started_at', { ascending: false, referencedTable: 'agent_runs' }).limit(1).maybeSingle(),
  ])

  let lastCostUsd: number | null = null
  if (output?.run_id) {
    const { data: calls } = await supabase.from('llm_calls').select('cost_usd').eq('run_id', output.run_id).eq('agent', agent)
    lastCostUsd = (calls ?? []).reduce((s, c) => s + Number(c.cost_usd ?? 0), 0)
  }

  return {
    lastRunAt: output?.created_at ?? null,
    version: output?.version ?? null,
    running: step?.status === 'running' || step?.status === 'queued',
    lastStep: step ? { status: step.status, detail: step.detail } : null,
    lastCostUsd,
  }
}

/** The agent's current output, parsed by the caller's schema. */
export async function currentOutput(productId: string, agent: AgentKey) {
  const { data } = await db().from('agent_outputs').select('id, content_json, sources, version, created_at')
    .eq('product_id', productId).eq('agent_name', agent).in('status', ['current', 'draft'])
    .order('version', { ascending: false }).limit(1).maybeSingle()
  return data
}

/** How many things are waiting for the founder, for the sidebar badge and Today. */
export async function pendingCounts(productId: string) {
  const supabase = db()
  const [content, outreach, brain] = await Promise.all([
    supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('status', 'draft'),
    supabase.from('outreach_targets').select('id', { count: 'exact', head: true }).eq('product_id', productId).eq('status', 'identified'),
    supabase.from('product_brains').select('strategy_status').eq('product_id', productId).maybeSingle(),
  ])
  const strategy = brain.data?.strategy_status === 'draft' ? 1 : 0
  return {
    content: content.count ?? 0,
    outreach: outreach.count ?? 0,
    strategy,
    total: (content.count ?? 0) + (outreach.count ?? 0) + strategy,
  }
}
