import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AGENTS, AGENT_KEYS, DEFAULT_KEY, allowedRef, refToString, type AgentKey } from '@/lib/llm/models'

/**
 * Save the per-agent model choices from Settings. Only known models, or a sane
 * model id on an AI set up in Settings → Your AI, are accepted. A pick that
 * matches the team-wide choice isn't stored, so switching the team's AI later
 * moves every agent that wasn't deliberately set apart.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { data: profile } = await db().from('profiles').select('agent_models').eq('id', 1).single()
  const team = ((profile?.agent_models ?? {}) as Record<string, string>)[DEFAULT_KEY]
  const models: Partial<Record<AgentKey | typeof DEFAULT_KEY, string>> = team ? { [DEFAULT_KEY]: team } : {}
  for (const key of AGENT_KEYS) {
    const v = body[key]
    if (typeof v !== 'string' || !allowedRef(v)) continue
    if (v === (team ?? refToString(AGENTS[key].model))) continue
    models[key] = v
  }
  const { error } = await db().from('profiles').update({ agent_models: models }).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, models })
}
