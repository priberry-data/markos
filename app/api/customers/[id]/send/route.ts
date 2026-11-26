import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildOutreachEmailHtml, sendEmail } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'

/**
 * Send the Customer team's draft — the founder's click, to an address the
 * founder entered. No placeholders, a configured sender, and at most one
 * message per customer per two weeks unless the founder overrides.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { force } = await req.json().catch(() => ({})) as { force?: boolean }
  const supabase = db()
  const { data: c } = await supabase.from('customers').select('*').eq('id', id).single()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!c.email?.includes('@')) return NextResponse.json({ error: 'Add an email address for this customer first.' }, { status: 400 })
  if (!c.draft_body?.trim()) return NextResponse.json({ error: 'There is no draft to send.' }, { status: 400 })
  const gap = findPlaceholder(c.draft_body) ?? findPlaceholder(c.draft_subject)
  if (gap) return NextResponse.json({ error: `The draft still contains ${gap}. Edit it first.` }, { status: 400 })
  if (!force && c.last_contacted_at && Date.now() - Date.parse(c.last_contacted_at) < 14 * 86400_000) {
    return NextResponse.json({ error: `You wrote to ${c.name} less than two weeks ago.`, canForce: true }, { status: 409 })
  }
  if (!process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: 'Set RESEND_FROM_EMAIL in .env.local to an address on a domain verified in Resend.' }, { status: 400 })
  }
  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to: c.email, subject: c.draft_subject?.trim() || 'A quick question',
    html: buildOutreachEmailHtml(c.draft_body, profile?.name ?? ''), replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 })
  const now = new Date().toISOString()
  await supabase.from('customers').update({ last_contacted_at: now, draft_subject: null, draft_body: null, draft_purpose: null, updated_at: now }).eq('id', id)
  await supabase.from('customer_notes').insert({ product_id: c.product_id, customer_id: id, content: `Sent: ${c.draft_subject ?? ''}\n\n${c.draft_body}` })
  return NextResponse.json({ ok: true })
}
