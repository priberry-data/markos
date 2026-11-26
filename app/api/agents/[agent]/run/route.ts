import { NextResponse } from 'next/server'
import { AGENT_KEYS, type AgentKey } from '@/lib/llm/models'
import { describeFailure, startAgentRun } from '@/lib/engine/orchestrator'

/**
 * Run one agent again from the approved strategy. Accepts JSON or a plain form
 * post — the old "Regenerate content" form posted form data to a route that
 * only read JSON, so it always errored.
 */
export async function POST(req: Request, { params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params
  if (!AGENT_KEYS.includes(agent as AgentKey)) return NextResponse.json({ error: 'Unknown agent' }, { status: 404 })

  let productId: string | undefined
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    productId = ((await req.json().catch(() => ({}))) as { productId?: string }).productId
  } else {
    productId = (await req.formData().catch(() => null))?.get('productId')?.toString()
  }
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  try {
    const runId = await startAgentRun(productId, agent as AgentKey)
    if (!type.includes('application/json')) return NextResponse.redirect(new URL(req.headers.get('referer') ?? '/brief', req.url), 303)
    return NextResponse.json({ success: true, runId })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
