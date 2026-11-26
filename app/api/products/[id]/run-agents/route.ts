import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startLaunch, describeFailure } from '@/lib/engine/orchestrator'

/** Start a full launch: research → strategy → (your approval) → production. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: product } = await db().from('products').select('id').eq('id', id).single()
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  try {
    const runId = await startLaunch(id)
    return NextResponse.json({ success: true, runId })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 500 })
  }
}
