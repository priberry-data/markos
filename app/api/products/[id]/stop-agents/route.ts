import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cancelRun } from '@/lib/engine/orchestrator'

/** Stop the product's active run. The in-flight AI calls are aborted, not just relabelled. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params

  const { data: run } = await db()
    .from('agent_runs')
    .select('id')
    .eq('product_id', productId)
    .in('status', ['running', 'awaiting_approval'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) return NextResponse.json({ error: 'No active run found' }, { status: 404 })

  await cancelRun(run.id)
  return NextResponse.json({ success: true })
}
