import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findPlaceholder } from '@/lib/engine/sources'

/**
 * Approve all the drafts the founder was looking at: `items` lists each card's id and version
 * (its updated_at, as the page showed it). A draft that changed since, or arrived since, is left
 * for them to see; one with a template gap is skipped. The counts come from the writes themselves.
 */
export async function POST(req: Request) {
  const { productId, items } = (await req.json().catch(() => ({}))) as { productId?: string; items?: Array<{ id?: unknown; version?: unknown }> }
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  if (!Array.isArray(items)) return NextResponse.json({ error: 'Reload the page and approve again: MarkOS approves only the versions on your screen.' }, { status: 409 })
  const shown = new Map(items.filter(i => typeof i?.id === 'string' && typeof i?.version === 'string' && i.version)
    .map(i => [i.id as string, i.version as string]))
  if (shown.size === 0) return NextResponse.json({ success: true, approved: 0, skipped: 0, changed: items.length })

  const { data: drafts, error: readError } = await db().from('content_items').select('id, title, body')
    .eq('product_id', productId).eq('status', 'draft').in('id', [...shown.keys()])
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  let approved = 0
  let skipped = 0
  const now = new Date().toISOString()
  for (const d of drafts ?? []) {
    if (findPlaceholder(d.body) || findPlaceholder(d.title)) { skipped++; continue }
    const { data, error } = await db().from('content_items').update({ status: 'approved', updated_at: now })
      .eq('id', d.id).eq('product_id', productId).eq('status', 'draft').eq('updated_at', shown.get(d.id)!).select('id')
    if (error) return NextResponse.json({ error: error.message, approved }, { status: 500 })
    approved += data?.length ?? 0
  }
  return NextResponse.json({ success: true, approved, skipped, changed: items.length - approved - skipped })
}
