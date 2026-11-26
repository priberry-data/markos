import { NextRequest, NextResponse } from 'next/server'
import { previewDirective } from '@/lib/engine/execs/chief-of-staff'
import { describeFailure } from '@/lib/engine/orchestrator'

/** Who would pick this up? A live, read-only preview while the founder types or speaks. */
export async function POST(req: NextRequest) {
  const { text } = await req.json().catch(() => ({})) as { text?: string }
  try {
    return NextResponse.json(await previewDirective(text ?? '', req.signal))
  } catch (err) {
    // The panel falls back to the instant reading; say why the semantic one isn't there.
    return NextResponse.json({ error: describeFailure(err).message }, { status: 503 })
  }
}
