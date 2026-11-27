import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail, buildOutreachEmailHtml } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'
import { CHANGED, RELOAD, claimForSend, readShown, sameAsShown, stillShown, unclaim } from '@/lib/engine/send-guard'

/**
 * Send an outreach email. Refuses unless: the address was confirmed by the
 * founder (never one an agent proposed on its own), the message has no
 * [placeholder] left, and a real sender address is configured. The old route
 * would email any string containing "@" — including addresses the model made up.
 * It sends the words the card showed, once (lib/engine/send-guard.ts).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const shown = await readShown(req)
  const supabase = db()

  const { data: t } = await supabase.from('outreach_targets').select('*').eq('id', id).single()
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (t.sent_at) return NextResponse.json({ error: `This was already sent, on ${String(t.sent_at).slice(0, 10)}.` }, { status: 409 })
  if (!shown.version) return NextResponse.json({ error: RELOAD }, { status: 409 })
  if (!(await stillShown('outreach_targets', id, shown.version))) return NextResponse.json({ error: CHANGED }, { status: 409 })

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

  // Claimed as sent before it goes, in the same write that checks nothing changed: never twice.
  const stamp = new Date().toISOString()
  const claim = { status: 'contacted', sent_at: stamp, updated_at: stamp }
  const row = await claimForSend('outreach_targets', id, shown.version, claim, 'sent_at')
  if (!row) return NextResponse.json({ error: CHANGED }, { status: 409 })
  const before = { status: t.status, sent_at: null, updated_at: shown.version }
  const address = String(row.handle_or_email ?? '').trim()
  const body = row.outreach_draft as string | null
  const subject = row.draft_subject as string | null
  if (!sameAsShown({ to: address, subject, body }, shown) || !row.contact_confirmed || findPlaceholder(body) || findPlaceholder(subject)) {
    await unclaim('outreach_targets', id, stamp, before, claim, 'sent_at')
    return NextResponse.json({ error: CHANGED }, { status: 409 })
  }

  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to: address,
    subject: subject?.trim() || `A quick note for ${row.name}`,
    html: buildOutreachEmailHtml(body ?? '', profile?.name ?? ''),
    replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) {
    await unclaim('outreach_targets', id, stamp, before, claim, 'sent_at')
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ success: true, email_id: result.id })
}
