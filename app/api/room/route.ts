import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { founderSays } from '@/lib/engine/execs/team-room'
import { runningJobIds } from '@/lib/utils/jobs'

/** The room: recent messages, and whether the team is still replying. */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get('since')
  let q = db().from('team_messages').select('*').order('created_at', { ascending: false }).limit(200)
  if (since) q = q.gt('created_at', since)
  const { data } = await q
  return NextResponse.json({
    messages: (data ?? []).reverse(),
    replying: runningJobIds().some(j => j.startsWith('room:')),
  })
}

export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({})) as { text?: string }
  try {
    return NextResponse.json({ id: await founderSays(text ?? '') })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
