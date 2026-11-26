import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const TEXT = ['title', 'metric', 'unit', 'owner', 'why', 'status', 'due'] as const
const NUM = ['current', 'target'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of TEXT) if (k in body) patch[k] = body[k] === '' ? null : body[k]
  for (const k of NUM) if (k in body) {
    const n = body[k] === '' || body[k] == null ? null : Number(body[k])
    if (n !== null && !Number.isFinite(n)) return NextResponse.json({ error: `${k} must be a number` }, { status: 400 })
    patch[k] = n
  }
  if (patch.status && !['proposed', 'active', 'achieved', 'dropped'].includes(String(patch.status))) {
    return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
  }
  const { error } = await db().from('goals').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
