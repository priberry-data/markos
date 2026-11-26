import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const EDITABLE = ['name', 'email', 'company', 'segment', 'notes', 'draft_subject', 'draft_body', 'draft_purpose'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k]
  const { error } = await db().from('customers').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db().from('customers').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
