import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { addHouseRule } from '@/lib/engine/items'

export async function GET(req: Request) {
  const productId = new URL(req.url).searchParams.get('productId')
  if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })
  const { data, error } = await db().from('house_rules').select('*').eq('product_id', productId).eq('active', true).order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rules: data })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { productId?: string; rule?: string }
  if (!body.productId || !body.rule?.trim()) return NextResponse.json({ error: 'productId and rule are required' }, { status: 400 })
  try {
    const id = await addHouseRule(body.productId, body.rule.slice(0, 500), 'manual')
    return NextResponse.json({ success: true, id })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
