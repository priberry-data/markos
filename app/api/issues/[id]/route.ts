import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { status } = await req.json().catch(() => ({})) as { status?: string }
  if (!['open', 'fixed', 'wont_fix'].includes(status ?? '')) return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
  const { error } = await db().from('issues').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
