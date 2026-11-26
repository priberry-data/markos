import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { rerouteTask } from '@/lib/engine/execs/chief-of-staff'
import { dispatchTask } from '@/lib/engine/execs/tasks'
import { EXEC_KEYS, type ExecKey } from '@/lib/engine/schemas'
import { cancelJob } from '@/lib/utils/jobs'

/** reroute (to another exec), retry (a failed task), or cancel. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { action?: string; exec?: string }
  try {
    if (body.action === 'reroute') {
      if (!body.exec || !(EXEC_KEYS as readonly string[]).includes(body.exec)) throw new Error('Pick an exec')
      await rerouteTask(id, body.exec as ExecKey)
    } else if (body.action === 'retry') {
      const { error } = await db().from('tasks').update({ status: 'queued', error_message: null, started_at: null, finished_at: null })
        .eq('id', id).in('status', ['failed', 'cancelled'])
      if (error) throw new Error(error.message)
      dispatchTask(id)
    } else if (body.action === 'done') {
      // The founder ticking off their own to-do.
      const { error } = await db().from('tasks').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', id).eq('exec', 'founder')
      if (error) throw new Error(error.message)
    } else if (body.action === 'cancel') {
      cancelJob(`task:${id}`)
      await db().from('tasks').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).in('status', ['queued', 'running'])
    } else {
      throw new Error('Unknown action')
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
