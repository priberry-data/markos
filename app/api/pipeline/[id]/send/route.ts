import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail, buildOutreachEmailHtml } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'
import { CHANGED, RELOAD, claimForSend, readShown, sameAsShown, stillShown, unclaim } from '@/lib/engine/send-guard'

/**
 * Send a pitch. The same guards as outreach: an address the founder confirmed,
 * no [placeholder] left, a configured sender. Sending is always the founder's
 * click — the team never emails anyone on its own. It sends the words the card
 * showed, once (lib/engine/send-guard.ts); pitching someone already contacted
 * asks first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const shown = await readShown(req)
  const supabase = db()
  const { data: row } = await supabase.from('pipeline').select('*').eq('id', id).single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!shown.version) return NextResponse.json({ error: RELOAD }, { status: 409 })
  if (!(await stillShown('pipeline', id, shown.version))) return NextResponse.json({ error: CHANGED }, { status: 409 })

  const to = (row.contact ?? '').trim()
  if (!to.includes('@')) return NextResponse.json({ error: 'Add an email address first.' }, { status: 400 })
  if (!row.contact_confirmed) return NextResponse.json({ error: 'Confirm this email address before sending.' }, { status: 400 })
  if (!row.pitch_body?.trim()) return NextResponse.json({ error: 'There is no pitch to send yet.' }, { status: 400 })
  const gap = findPlaceholder(row.pitch_body) ?? findPlaceholder(row.pitch_subject)
  if (gap) return NextResponse.json({ error: `The pitch still contains ${gap}. Edit it first.` }, { status: 400 })
  if (!shown.force && row.last_contacted_at) {
    return NextResponse.json({ error: `You already contacted ${row.name}, on ${String(row.last_contacted_at).slice(0, 10)}.`, canForce: true }, { status: 409 })
  }
  if (!process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: 'Set RESEND_FROM_EMAIL in .env.local to an address on a domain verified in Resend.' }, { status: 400 })
  }

  const stamp = new Date().toISOString()
  const claim = { stage: 'contacted', last_contacted_at: stamp, updated_at: stamp }
  const claimed = await claimForSend('pipeline', id, shown.version, claim)
  if (!claimed) return NextResponse.json({ error: CHANGED }, { status: 409 })
  const before = { stage: row.stage, last_contacted_at: row.last_contacted_at, updated_at: shown.version }
  const address = String(claimed.contact ?? '').trim()
  const body = claimed.pitch_body as string | null
  const subject = claimed.pitch_subject as string | null
  if (!sameAsShown({ to: address, subject, body }, shown) || !claimed.contact_confirmed || !body?.trim() || findPlaceholder(body) || findPlaceholder(subject)) {
    await unclaim('pipeline', id, stamp, before, claim, 'last_contacted_at')
    return NextResponse.json({ error: CHANGED }, { status: 409 })
  }

  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to: address,
    subject: subject?.trim() || `A quick note for ${claimed.name}`,
    html: buildOutreachEmailHtml(body, profile?.name ?? ''),
    replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) {
    await unclaim('pipeline', id, stamp, before, claim, 'last_contacted_at')
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ success: true })
}
