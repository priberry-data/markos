import { db } from '@/lib/db'
import type { ExecReport } from '../schemas'

// What each member of the team is doing right now — for their card on Home
// and their own page. Everything here is read from real records.

export const SEATS = ['chief_of_staff', 'ea', 'cmo', 'sales', 'cfo', 'data', 'cpo', 'cto', 'qa', 'platform', 'cx', 'coo'] as const
export type SeatKey = (typeof SEATS)[number]

export interface SeatStatus {
  seat: SeatKey
  state: 'working' | 'queued' | 'idle'
  now: string | null          // what it's doing this minute
  queued: number
  doneToday: number
  headline: string | null     // its latest report's one line
  headlineAt: string | null
}

export async function teamStatus(): Promise<Record<SeatKey, SeatStatus>> {
  const supabase = db()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [{ data: open }, { data: done }, { data: reports }, { data: night }, { data: meetings }] = await Promise.all([
    supabase.from('tasks').select('exec, task, status, started_at').in('status', ['queued', 'running']).neq('exec', 'founder'),
    supabase.from('tasks').select('exec').eq('status', 'done').gte('finished_at', today.toISOString()),
    supabase.from('exec_reports').select('exec, report, created_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('nights').select('status, brief, log, started_at').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('meetings').select('id').eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()),
  ])
  const out = {} as Record<SeatKey, SeatStatus>
  for (const seat of SEATS) {
    const mine = (open ?? []).filter(t => t.exec === seat)
    const running = mine.find(t => t.status === 'running')
    const latest = (reports ?? []).find(r => r.exec === seat)
    out[seat] = {
      seat,
      state: running ? 'working' : mine.length ? 'queued' : 'idle',
      now: running ? String(running.task) : null,
      queued: mine.filter(t => t.status === 'queued').length,
      doneToday: (done ?? []).filter(t => t.exec === seat).length,
      headline: latest ? (latest.report as ExecReport).headline : null,
      headlineAt: latest ? String(latest.created_at) : null,
    }
  }
  // The Chief of Staff and Myra don't file exec reports; show their real work instead.
  const log = (night?.log ?? []) as Array<{ step: string }>
  if (night?.status === 'running') {
    out.chief_of_staff.state = 'working'
    out.chief_of_staff.now = `Running the night shift — ${log[log.length - 1]?.step ?? 'starting'}`
  }
  const brief = night?.brief as { headline?: string } | null
  if (brief?.headline) { out.chief_of_staff.headline = brief.headline; out.chief_of_staff.headlineAt = String(night!.started_at) }
  const upcoming = (meetings ?? []).length
  out.ea.headline = upcoming ? `${upcoming} meeting${upcoming > 1 ? 's' : ''} booked with you` : 'Your calendar is clear'
  return out
}
