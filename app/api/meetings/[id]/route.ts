import { NextRequest, NextResponse } from 'next/server'
import { cancelMeeting, endMeeting, rescheduleMeeting, sayInMeeting } from '@/lib/engine/execs/office'
import { describeFailure } from '@/lib/engine/orchestrator'

/** say (talk in the meeting room), end (minutes + action items), cancel, reschedule. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { action?: string; text?: string }
  try {
    if (body.action === 'say') return NextResponse.json({ replies: await sayInMeeting(id, body.text ?? '') })
    if (body.action === 'end') return NextResponse.json({ minutes: await endMeeting(id) })
    if (body.action === 'cancel') { await cancelMeeting(id); return NextResponse.json({ ok: true }) }
    if (body.action === 'reschedule') return NextResponse.json({ scheduledAt: await rescheduleMeeting(id) })
    throw new Error('Unknown action')
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
