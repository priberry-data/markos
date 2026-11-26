import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// The owner settings row (profiles.id = 1). Only these fields may be written.
const FIELDS = ['name', 'role', 'company', 'goals', 'sender_email', 'run_budget_usd', 'night_budget_usd',
  'work_start', 'work_end', 'meeting_windows', 'max_meetings_per_day'] as const

export async function GET() {
  const { data, error } = await db().from('profiles').select('*').eq('id', 1).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const update: Record<string, unknown> = {}
  for (const field of FIELDS) {
    if (body[field] !== undefined) update[field] = body[field]
  }
  if (update.run_budget_usd !== undefined) {
    const n = Number(update.run_budget_usd)
    if (!Number.isFinite(n) || n <= 0 || n > 100) {
      return NextResponse.json({ error: 'The run budget must be between $0.01 and $100' }, { status: 400 })
    }
    update.run_budget_usd = n
  }
  for (const k of ['work_start', 'work_end'] as const) {
    if (update[k] !== undefined && !/^\d{1,2}:\d{2}$/.test(String(update[k]))) return NextResponse.json({ error: 'Times look like 10:00' }, { status: 400 })
  }
  if (update.meeting_windows !== undefined && !/^\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*(,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)*$/.test(String(update.meeting_windows))) {
    return NextResponse.json({ error: 'Meeting windows look like 11:00-13:00, 16:00-18:00' }, { status: 400 })
  }
  if (update.max_meetings_per_day !== undefined) {
    const n = Number(update.max_meetings_per_day)
    if (!Number.isInteger(n) || n < 0 || n > 10) return NextResponse.json({ error: 'Meetings per day: 0 to 10' }, { status: 400 })
    update.max_meetings_per_day = n
  }
  if (update.night_budget_usd !== undefined) {
    const n = Number(update.night_budget_usd)
    if (!Number.isFinite(n) || n <= 0 || n > 500) return NextResponse.json({ error: 'The night budget must be between $1 and $500' }, { status: 400 })
    update.night_budget_usd = n
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await db().from('profiles').update(update).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
