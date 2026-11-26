import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail, buildOutreachEmailHtml } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'

/**
 * Send a pitch. The same guards as outreach: an address the founder confirmed,
 * no [placeholder] left, a configured sender. Sending is always the founder's
 * click — the team never emails anyone on its own.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = db()
  const { data: row } = await supabase.from('pipeline').select('*').eq('id', id).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const to = (row.contact ?? '').trim()
  if (!to.includes('@')) return NextResponse.json({ error: 'Add an email address first.' }, { status: 400 })
  if (!row.contact_confirmed) return NextResponse.json({ error: 'Confirm this email address before sending.' }, { status: 400 })
  if (!row.pitch_body?.trim()) return NextResponse.json({ error: 'There is no pitch to send yet.' }, { status: 400 })
  const gap = findPlaceholder(row.pitch_body) ?? findPlaceholder(row.pitch_subject)
  if (gap) return NextResponse.json({ error: `The pitch still contains ${gap}. Edit it first.` }, { status: 400 })
  if (!process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: 'Set RESEND_FROM_EMAIL in .env.local to an address on a domain verified in Resend.' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to,
    subject: row.pitch_subject?.trim() || `A quick note for ${row.name}`,
    html: buildOutreachEmailHtml(row.pitch_body, profile?.name ?? ''),
    replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 })

  const now = new Date().toISOString()
  await supabase.from('pipeline').update({ stage: 'contacted', last_contacted_at: now, updated_at: now }).eq('id', id)
  return NextResponse.json({ success: true })
}
