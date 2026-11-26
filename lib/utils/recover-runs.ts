import { db } from '@/lib/db'

/**
 * Runs execute inside the MarkOS server process. If that process stops (the
 * window was closed, the Mac restarted), a run left mid-way would sit at
 * "running" forever. On startup, mark any such run as failed with a reason the
 * founder can act on. Runs paused for approval are left alone — they are
 * waiting for you, not for the process.
 */
export async function recoverInterruptedRuns() {
  const { data, error } = await db()
    .from('agent_runs')
    .update({
      status: 'failed',
      error_message: 'Interrupted — MarkOS was closed while this run was in progress. Run it again.',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .select('id')

  if (error) {
    console.error('[markos] could not recover interrupted runs:', error.message)
    return
  }
  if (data && data.length > 0) {
    console.warn(`[markos] marked ${data.length} interrupted run(s) as failed`)
  }
}

/**
 * The same for the executive team: a night shift that was running is marked
 * interrupted, and a task that was mid-way goes back in the queue so it runs
 * next time instead of being lost.
 */
export async function recoverInterruptedWork() {
  const now = new Date().toISOString()
  const [nights, tasks, directives, posts] = await Promise.all([
    db().from('nights').update({ status: 'failed', error_message: 'Interrupted — MarkOS stopped during the night shift.', finished_at: now })
      .eq('status', 'running').select('id'),
    db().from('tasks').update({ status: 'queued', started_at: null }).eq('status', 'running').select('id'),
    db().from('directives').update({ status: 'failed', error_message: 'Interrupted — MarkOS stopped while routing this. Send it again.' })
      .eq('status', 'routing').select('id'),
    // A post cut off mid-send may or may not have gone out. Never retry it
    // automatically (it could post twice): back to draft for the founder to check.
    db().from('content_items').update({ status: 'draft', rejected_reason: 'MarkOS stopped while posting this — check whether it went out before approving it again.' })
      .eq('status', 'posting').select('id'),
  ])
  for (const [what, res] of [['night shift(s)', nights], ['task(s)', tasks], ['instruction(s)', directives], ['interrupted post(s)', posts]] as const) {
    if (res.error) console.error(`[markos] could not recover ${what}:`, res.error.message)
    else if (res.data?.length) console.warn(`[markos] recovered ${res.data.length} interrupted ${what}`)
  }
}
