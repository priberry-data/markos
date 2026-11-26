import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Retire a house rule (kept for history, no longer given to agents). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await db().from('house_rules').update({ active: false }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
