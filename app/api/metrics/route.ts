import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Record a number only the founder knows (signups, traffic, revenue, followers). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { productId?: string; metric?: string; value?: unknown; note?: string; recorded_for?: string }
  const value = Number(b.value)
  if (!b.productId || !b.metric?.trim() || !Number.isFinite(value)) {
    return NextResponse.json({ error: 'productId, metric and a numeric value are required' }, { status: 400 })
  }
  const { error } = await db().from('metric_entries').insert({
    product_id: b.productId, metric: b.metric.trim().slice(0, 80), value, note: b.note?.trim() || null,
    ...(b.recorded_for ? { recorded_for: b.recorded_for } : {}),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
