import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail, buildOutreachEmailHtml } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'

/**
 * Send an outreach email. Refuses unless: the address was confirmed by the
 * founder (never one an agent proposed on its own), the message has no
 * [placeholder] left, and a real sender address is configured. The old route
 * would email any string containing "@" — including addresses the model made up.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = db()

  const { data: t } = await supabase.from('outreach_targets').select('*').eq('id', id).single()
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const to = (t.handle_or_email ?? '').trim()
  if (!to.includes('@')) return NextResponse.json({ error: 'Add an email address for this target first.' }, { status: 400 })
  if (!t.contact_confirmed) {
    return NextResponse.json({ error: 'Confirm this email address before sending — MarkOS never emails an address you haven’t checked.' }, { status: 400 })
  }
  const gap = findPlaceholder(t.outreach_draft) ?? findPlaceholder(t.draft_subject)
  if (gap) return NextResponse.json({ error: `The message still contains ${gap}. Edit it first.` }, { status: 400 })
  if (!process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: 'Set RESEND_FROM_EMAIL in .env.local to an address on a domain verified in Resend.' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to,
    subject: t.draft_subject?.trim() || `A quick note for ${t.name}`,
    html: buildOutreachEmailHtml(t.outreach_draft ?? '', profile?.name ?? ''),
    replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 })

  await supabase.from('outreach_targets')
    .update({ status: 'contacted', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  return NextResponse.json({ success: true, email_id: result.id })
}
