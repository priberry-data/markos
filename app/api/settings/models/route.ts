import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AGENT_KEYS, MODEL_CHOICES, refToString, type AgentKey } from '@/lib/llm/models'

/** Save the per-agent model choices from Settings. Only known agents and models are accepted. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const allowed = new Set(MODEL_CHOICES.map(m => refToString(m.ref)))
  const models: Partial<Record<AgentKey, string>> = {}
  for (const key of AGENT_KEYS) {
    const v = body[key]
    if (typeof v === 'string' && allowed.has(v)) models[key] = v
  }
  const { error } = await db().from('profiles').update({ agent_models: models }).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, models })
}
