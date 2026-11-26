import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { startLaunch } from '@/lib/engine/orchestrator'

export async function GET() {
  const supabase = db()

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data })
}

export async function POST(req: Request) {
  const supabase = db()

  const body = (await req.json()) as Record<string, unknown>

  // Only accept the fields the product form actually collects — the raw body
  // used to be spread straight into the table, so a caller could set any column.
  const FIELDS = [
    'name', 'url', 'description', 'category', 'stage', 'target_audience',
    'target_geography', 'monthly_budget', 'goals', 'competitors', 'already_tried',
    'brand_voice', 'logo_url', 'primary_color', 'secondary_color',
    'currency', 'ad_budget_monthly', 'launch_date', 'raising', 'announcing_launch',
  ] as const

  const payload: Record<string, unknown> = {}
  for (const field of FIELDS) {
    // Empty form fields mean "not set", not an empty string or invalid date.
    if (body[field] !== undefined && body[field] !== '') payload[field] = body[field]
  }

  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof payload.url !== 'string' || !payload.url.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const { data: product, error } = await supabase
    .from('products')
    .insert({ ...payload, status: 'active' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A newly added product becomes the one the dashboard is showing.
  await supabase
    .from('profiles')
    .update({ active_product_id: product.id })
    .eq('id', 1)

  // Start the launch straight away: research → strategy → your approval.
  try {
    await startLaunch(product.id)
  } catch (err) {
    console.error('[markos] could not start the launch for a new product:', err)
  }

  return NextResponse.json({ product }, { status: 201 })
}
