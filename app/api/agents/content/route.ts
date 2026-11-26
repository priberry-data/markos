import { NextResponse } from 'next/server'
import { describeFailure, startAgentRun } from '@/lib/engine/orchestrator'

/** Regenerate the content calendar (NOVA) from the approved strategy. */
export async function POST(req: Request) {
  const type = req.headers.get('content-type') ?? ''
  const productId = type.includes('application/json')
    ? ((await req.json().catch(() => ({}))) as { productId?: string }).productId
    : (await req.formData().catch(() => null))?.get('productId')?.toString()
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  try {
    await startAgentRun(productId, 'content')
    if (!type.includes('application/json')) return NextResponse.redirect(new URL('/content', req.url), 303)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
