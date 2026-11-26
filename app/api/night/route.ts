import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startNight } from '@/lib/engine/execs/night'
import { cancelJob } from '@/lib/utils/jobs'

/** The latest night shift: status, progress log and brief. */
export async function GET() {
  const { data } = await db().from('nights').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle()
  return NextResponse.json({ night: data })
}

/** Start the night shift now. The scheduled job sends x-markos-trigger: schedule. */
export async function POST(req: NextRequest) {
  try {
    const trigger = req.headers.get('x-markos-trigger') === 'schedule' ? 'schedule' : 'manual'
    const id = await startNight(trigger)
    return NextResponse.json({ id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

/** Stop the running night shift. Work already saved is kept. */
export async function DELETE() {
  const { data } = await db().from('nights').select('id').eq('status', 'running').maybeSingle()
  if (!data) return NextResponse.json({ stopped: false })
  const stopped = cancelJob(`night:${data.id}`, 'Stopped by you')
  if (!stopped) {
    await db().from('nights').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', data.id)
  }
  return NextResponse.json({ stopped: true })
}
