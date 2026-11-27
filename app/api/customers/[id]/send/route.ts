import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildOutreachEmailHtml, sendEmail } from '@/lib/api/resend'
import { findPlaceholder } from '@/lib/engine/sources'
import { CHANGED, RELOAD, claimForSend, readShown, sameAsShown, stillShown, unclaim } from '@/lib/engine/send-guard'

/**
 * Send the Customer team's draft — the founder's click, to an address the
 * founder entered. No placeholders, a configured sender, and at most one
 * message per customer per two weeks unless the founder overrides.
 * It sends the words the card showed, once (lib/engine/send-guard.ts).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const shown = await readShown(req)
  const supabase = db()
  const { data: c } = await supabase.from('customers').select('*').eq('id', id).single()
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!shown.version) return NextResponse.json({ error: RELOAD }, { status: 409 })
  if (!(await stillShown('customers', id, shown.version))) return NextResponse.json({ error: CHANGED }, { status: 409 })
  if (!c.email?.includes('@')) return NextResponse.json({ error: 'Add an email address for this customer first.' }, { status: 400 })
  if (!c.draft_body?.trim()) return NextResponse.json({ error: 'There is no draft to send.' }, { status: 400 })
  const gap = findPlaceholder(c.draft_body) ?? findPlaceholder(c.draft_subject)
  if (gap) return NextResponse.json({ error: `The draft still contains ${gap}. Edit it first.` }, { status: 400 })
  if (!shown.force && c.last_contacted_at && Date.now() - Date.parse(c.last_contacted_at) < 14 * 86400_000) {
    return NextResponse.json({ error: `You wrote to ${c.name} less than two weeks ago.`, canForce: true }, { status: 409 })
  }
  if (!process.env.RESEND_FROM_EMAIL) {
    return NextResponse.json({ error: 'Set RESEND_FROM_EMAIL in .env.local to an address on a domain verified in Resend.' }, { status: 400 })
  }

  const stamp = new Date().toISOString()
  const claim = { last_contacted_at: stamp, updated_at: stamp }
  const row = await claimForSend('customers', id, shown.version, claim)
  if (!row) return NextResponse.json({ error: CHANGED }, { status: 409 })
  const before = { last_contacted_at: c.last_contacted_at, updated_at: shown.version }
  const to = String(row.email ?? '').trim()
  const body = row.draft_body as string | null
  const subject = row.draft_subject as string | null
  if (!sameAsShown({ to, subject, body }, shown) || !to.includes('@') || !body?.trim() || findPlaceholder(body) || findPlaceholder(subject)) {
    await unclaim('customers', id, stamp, before, claim, 'last_contacted_at')
    return NextResponse.json({ error: CHANGED }, { status: 409 })
  }

  const { data: profile } = await supabase.from('profiles').select('name, sender_email').eq('id', 1).single()
  const result = await sendEmail({
    to, subject: subject?.trim() || 'A quick question',
    html: buildOutreachEmailHtml(body, profile?.name ?? ''), replyTo: profile?.sender_email ?? undefined,
  })
  if (result.error) {
    // The draft is still there: it's cleared only once the email has gone.
    await unclaim('customers', id, stamp, before, claim, 'last_contacted_at')
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  // Clear the draft that went, unless a new one was written while it was sending.
  await supabase.from('customers').update({ draft_subject: null, draft_body: null, draft_purpose: null }).eq('id', id).eq('updated_at', stamp)
  await supabase.from('customer_notes').insert({ product_id: c.product_id, customer_id: id, content: `Sent: ${subject ?? ''}\n\n${body}` })
  return NextResponse.json({ ok: true })
}
