import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const TEXT = ['name', 'url', 'description', 'category', 'stage', 'target_audience', 'target_geography', 'currency',
  'competitors', 'already_tried', 'brand_voice', 'primary_color', 'secondary_color', 'logo_url'] as const

/** Update a product's details — everything the agents use to tailor their work. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const update: Record<string, unknown> = {}

  for (const f of TEXT) {
    if (body[f] === undefined) continue
    const v = typeof body[f] === 'string' ? (body[f] as string).trim() : null
    update[f] = v || null
  }
  if (update.name === null || update.url === null) return NextResponse.json({ error: 'Name and website are required' }, { status: 400 })
  if (typeof update.currency === 'string') update.currency = update.currency.toUpperCase().slice(0, 3)
  if (body.ad_budget_monthly !== undefined) {
    const n = Number(body.ad_budget_monthly)
    if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'Ad budget must be a number (0 for none)' }, { status: 400 })
    update.ad_budget_monthly = n
  }
  if (body.launch_date !== undefined) update.launch_date = body.launch_date || null
  if (body.raising !== undefined) update.raising = Boolean(body.raising)
  if (body.announcing_launch !== undefined) update.announcing_launch = Boolean(body.announcing_launch)
  if (Array.isArray(body.goals)) update.goals = body.goals.filter(g => typeof g === 'string' && g.trim())
  if (body.night_enabled !== undefined) update.night_enabled = Boolean(body.night_enabled)
  if (Array.isArray(body.repo_paths)) {
    // Folders the execs may read. Must exist on this Mac; ~ is expanded.
    const paths = body.repo_paths
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map(x => x.trim().replace(/^~(?=\/|$)/, homedir()).replace(/\/+$/, ''))
    const missing = paths.filter(x => !x.startsWith('/') || !existsSync(x))
    if (missing.length) return NextResponse.json({ error: `Not found on this Mac: ${missing.join(', ')}` }, { status: 400 })
    update.repo_paths = [...new Set(paths)]
  }

  const { error } = await db().from('products').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await db().from('products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
