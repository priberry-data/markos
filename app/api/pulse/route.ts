import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// What changed, for the browser to poll. It replaces a realtime database connection in the
// browser: lighter pages (no database client shipped), and the database never has to be
// reachable from a web page. Behind the local guard like every other route.
//   ?since=<ISO time>  → notifications created after it. Pass the newest created_at you've
//                        seen: the database's clock, not the browser's or this server's.
//   ?productId=<uuid>  → a fingerprint of that product's runs and steps; it changes when
//                        any of them starts, finishes or fails
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const since = url.searchParams.get('since')
  const productId = url.searchParams.get('productId')
  const now = new Date().toISOString()
  const out: { now: string; notifications?: unknown[]; runs?: string } = { now }

  if (since && !Number.isNaN(Date.parse(since))) {
    const { data, error } = await db().from('notifications')
      .select('id, type, title, message, action_url, read, created_at')
      .gt('created_at', since).order('created_at', { ascending: false }).limit(30)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    out.notifications = data ?? []
  }

  if (productId && /^[0-9a-f-]{36}$/i.test(productId)) {
    const [runs, steps, stepCount] = await Promise.all([
      db().from('agent_runs').select('id, status').eq('product_id', productId).order('started_at', { ascending: false }).limit(10),
      db().from('run_steps').select('id, status').eq('product_id', productId).order('started_at', { ascending: false, nullsFirst: true }).limit(40),
      db().from('run_steps').select('id', { count: 'exact', head: true }).eq('product_id', productId),
    ])
    const err = runs.error ?? steps.error ?? stepCount.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })
    out.runs = createHash('sha1').update(JSON.stringify([runs.data, steps.data, stepCount.count])).digest('hex').slice(0, 16)
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
