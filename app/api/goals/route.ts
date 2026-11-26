import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { proposeGoals } from '@/lib/engine/execs/goals'
import { describeFailure } from '@/lib/engine/orchestrator'

/**
 * action: "propose" — the Chief of Staff drafts goals from the docs;
 * "confirm" — the founder makes every drafted goal active;
 * "add" — the founder adds one of their own (active at once).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    if (body.action === 'propose') return NextResponse.json({ drafted: await proposeGoals(req.signal) })
    if (body.action === 'confirm') {
      const { error } = await db().from('goals').update({ status: 'active', updated_at: new Date().toISOString() }).eq('status', 'proposed')
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'add') {
      const title = String(body.title ?? '').trim()
      if (!title) throw new Error('Give the goal a name')
      const { error } = await db().from('goals').insert({
        title, product_id: body.product_id || null, metric: body.metric || null,
        target: body.target === '' || body.target == null ? null : Number(body.target),
        due: body.due || null, owner: body.owner || null, status: 'active', source: 'founder',
      })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    throw new Error('Unknown action')
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}
