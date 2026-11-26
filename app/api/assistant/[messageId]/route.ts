import { NextResponse } from 'next/server'
import { confirmAction, dismissAction } from '@/lib/engine/assistant'
import { describeFailure } from '@/lib/engine/orchestrator'

/** Confirm (or dismiss) an action LYRA proposed. Body: { decision: 'confirm' | 'dismiss' } */
export async function POST(req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string }
  try {
    if (decision === 'dismiss') {
      await dismissAction(messageId)
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ success: true, result: await confirmAction(messageId) })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
