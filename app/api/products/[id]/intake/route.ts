import { NextRequest, NextResponse } from 'next/server'
import { confirmIntake, runIntake } from '@/lib/engine/execs/intake'
import { describeFailure } from '@/lib/engine/orchestrator'
import type { Intake } from '@/lib/engine/schemas'
import { startJob } from '@/lib/utils/jobs'
import { db } from '@/lib/db'

/** Read the product's repo and draft its profile (in the background). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db().from('products').update({ intake_status: 'reading' }).eq('id', id)
  startJob(`intake:${id}`, async signal => {
    try {
      await runIntake(id, signal)
    } catch (err) {
      await db().from('products').update({
        intake_status: 'failed', intake: { error: describeFailure(err).message },
      }).eq('id', id)
    }
  })
  return NextResponse.json({ ok: true })
}

/** The founder confirms the drafted profile, optionally edited. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { intake?: Intake }
  try {
    await confirmIntake(id, body.intake)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
