import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Switch which product the dashboard is showing. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = db()

  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('id', id)
    .single()
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await supabase
    .from('profiles')
    .update({ active_product_id: id })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
