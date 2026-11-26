import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const STAGES = ['identified', 'contacted', 'replied', 'meeting', 'won', 'lost', 'dropped']
const EDITABLE = ['stage', 'next_step', 'notes', 'pitch_subject', 'pitch_body', 'contact', 'contact_confirmed'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of EDITABLE) if (key in body) patch[key] = body[key]
  if (patch.stage && !STAGES.includes(String(patch.stage))) return NextResponse.json({ error: 'Unknown stage' }, { status: 400 })
  // Changing the address un-confirms it: the founder confirms the exact address that gets used.
  if ('contact' in body && !('contact_confirmed' in body)) patch.contact_confirmed = false
  if (patch.stage === 'contacted') patch.last_contacted_at = new Date().toISOString()
  const { error } = await db().from('pipeline').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
