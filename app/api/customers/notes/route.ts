import { NextRequest, NextResponse } from 'next/server'
import { synthesiseNote } from '@/lib/engine/execs/customers'
import { describeFailure } from '@/lib/engine/orchestrator'

/** The founder pastes a conversation; the Customer team synthesises and routes it. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { productId?: string; customerId?: string; content?: string }
  if (!body.productId) return NextResponse.json({ error: 'Pick a product' }, { status: 400 })
  try {
    return NextResponse.json({ synthesis: await synthesiseNote(body.productId, body.content ?? '', body.customerId ?? null) })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
