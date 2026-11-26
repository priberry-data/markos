import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Mark notifications read. Body: { ids: string[] } or { all: true }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown }
  const query = db().from('notifications').update({ read: true })

  if (body.all === true) {
    const { error } = await query.eq('read', false)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })

  const { error } = await query.in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
