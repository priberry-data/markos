import { NextRequest, NextResponse } from 'next/server'
import { bookFromRequest, replanMeetings, retryCalendarSync } from '@/lib/engine/execs/office'
import { describeFailure } from '@/lib/engine/orchestrator'

/** "Set up time with the CFO about team pricing" — the EA books it. */
export async function POST(req: NextRequest) {
  const { text, action } = await req.json().catch(() => ({})) as { text?: string; action?: string }
  if (action === 'sync') {
    await retryCalendarSync()
    return NextResponse.json({ ok: true })
  }
  if (action === 'replan') {
    try { return NextResponse.json({ booked: (await replanMeetings(req.signal)).length }) }
    catch (err) { return NextResponse.json({ error: describeFailure(err).message }, { status: 400 }) }
  }
  if (!text?.trim()) return NextResponse.json({ error: 'Say what the meeting is about' }, { status: 400 })
  try {
    const booked = await bookFromRequest(text)
    if (!booked) return NextResponse.json({ error: 'No free slot in your meeting windows in the next two weeks. Widen them in Settings.' }, { status: 409 })
    return NextResponse.json({ id: booked.id, scheduledAt: booked.scheduledAt })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
