import { NextResponse } from 'next/server'
import { describeFailure, reviseStrategy } from '@/lib/engine/orchestrator'

/** Ask SAGE for a new strategy draft guided by the founder's notes. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; notes?: string }
  const notes = body.notes?.trim()
  if (!body.productId || !notes) {
    return NextResponse.json({ error: 'productId and notes are required' }, { status: 400 })
  }
  try {
    const runId = await reviseStrategy(body.productId, notes.slice(0, 4000))
    return NextResponse.json({ success: true, runId })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 500 })
  }
}
