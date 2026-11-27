import { NextResponse } from 'next/server'
import {
  APPROVE_CHANGED, APPROVE_RELOAD, approveContent, confirmContact, editContent, editOutreach, refineItem, rejectItem, setContentStatus, setOutreachStatus,
} from '@/lib/engine/items'
import { describeFailure } from '@/lib/engine/orchestrator'

const TABLES = { content: 'content_items', outreach: 'outreach_targets' } as const
type Kind = keyof typeof TABLES

/** Edit an item's fields (keeps the previous version). */
export async function PATCH(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  if (!(kind in TABLES)) return NextResponse.json({ error: 'Unknown item type' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    if (kind === 'content') await editContent(id, body)
    else await editOutreach(id, body)
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: describeFailure(err).message }, { status: 400 })
  }
}

/**
 * Actions on an item.
 *   { action: 'approve', version }                        approve the version on screen (its updated_at)
 *   { action: 'posted' | 'draft' }                        content status
 *   { action: 'status', status }                          outreach pipeline stage
 *   { action: 'reject', reason? }                         reason becomes a house rule
 *   { action: 'refine', instruction }                     rewrite with an instruction
 *   { action: 'confirm_contact' }                         allow sending to this address
 */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params
  if (!(kind in TABLES)) return NextResponse.json({ error: 'Unknown item type' }, { status: 404 })
  const table = TABLES[kind as Kind]
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string; instruction?: string; status?: string; version?: unknown }

  try {
    switch (body.action) {
      case 'approve':
        if (kind !== 'content') throw new Error('Use action "status" for outreach')
        await approveContent(id, typeof body.version === 'string' ? body.version : '')
        break
      case 'posted':
      case 'draft':
        if (kind !== 'content') throw new Error('Use action "status" for outreach')
        await setContentStatus(id, body.action)
        break
      case 'status':
        if (kind !== 'outreach') throw new Error('Use approve/posted for content')
        await setOutreachStatus(id, body.status ?? '')
        break
      case 'reject':
        await rejectItem(table, id, body.reason)
        break
      case 'refine':
        return NextResponse.json({ success: true, item: await refineItem(table, id, body.instruction ?? '') })
      case 'confirm_contact':
        await confirmContact(id)
        break
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = describeFailure(err).message
    // An Approve refused because the card was out of date is a 409: the page then shows what's there now.
    const stale = message === APPROVE_CHANGED || message === APPROVE_RELOAD
    return NextResponse.json({ error: message }, { status: stale ? 409 : 400 })
  }
}
