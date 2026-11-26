import { NextRequest, NextResponse } from 'next/server'
import { submitDirective } from '@/lib/engine/execs/chief-of-staff'
import { EXEC_KEYS, type ExecKey } from '@/lib/engine/schemas'

/** One instruction from the founder. The Chief of Staff routes it in the background. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { text?: string; exec?: string }
  const exec = body.exec && (EXEC_KEYS as readonly string[]).includes(body.exec) ? (body.exec as ExecKey) : null
  try {
    const id = await submitDirective(body.text ?? '', exec)
    return NextResponse.json({ id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
