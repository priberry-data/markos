import { NextResponse } from 'next/server'
import { approveStrategy, describeFailure } from '@/lib/engine/orchestrator'
import { StrategySchema } from '@/lib/engine/schemas'

/**
 * Approve the product's strategy, optionally with the founder's edits. The
 * approved version is what every later agent writes from, and a launch paused
 * at the checkpoint continues.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; strategy?: unknown }
  if (!body.productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  let edited
  if (body.strategy !== undefined) {
    const parsed = StrategySchema.safeParse(body.strategy)
    if (!parsed.success) {
      return NextResponse.json({ error: 'The edited strategy is incomplete', issues: parsed.error.issues.slice(0, 5) }, { status: 400 })
    }
    edited = parsed.data
  }

  try {
    const runId = await approveStrategy(body.productId, edited)
    return NextResponse.json({ success: true, runId })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
