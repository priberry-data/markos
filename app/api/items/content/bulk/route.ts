import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findPlaceholder } from '@/lib/engine/sources'

/** Approve every draft for a product that has no template gaps left. */
export async function POST(req: Request) {
  const { productId } = (await req.json().catch(() => ({}))) as { productId?: string }
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  const { data: drafts } = await db().from('content_items').select('id, title, body').eq('product_id', productId).eq('status', 'draft')
  const ok = (drafts ?? []).filter(d => !findPlaceholder(d.body) && !findPlaceholder(d.title)).map(d => d.id)
  if (ok.length) {
    const { error } = await db().from('content_items').update({ status: 'approved', updated_at: new Date().toISOString() }).in('id', ok)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true, approved: ok.length, skipped: (drafts ?? []).length - ok.length })
}
