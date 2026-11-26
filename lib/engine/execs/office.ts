import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { addEvent, calendarEnabled, removeEvent } from '@/lib/calendar/mac'
import {
  AgendaSchema, MeetingRequestSchema, MeetingTurnSchema, MinutesSchema, EXEC_KEYS,
  type ExecKey, type ExecReport,
} from '../schemas'
import { applyModelSettings, portfolio, renderPortfolio, workContext } from './context'
import { EXECS, systemFor } from './roster'
import { createTasks } from './tasks'
import { post } from './team-room'

// The founder's office, run by the Executive Assistant.
//
// Meetings exist only for what can't be settled in writing: decisions,
// trade-offs, things the founder should hear first-hand. The EA groups what's
// waiting into as few meetings as possible, places them inside the founder's
// meeting windows (never in focus time, never over the daily limit), writes
// the agenda and pre-read, puts them on the Mac Calendar, runs the meeting
// room, writes minutes, and turns every action item into a dated task it
// chases until done.

const MIN = 60_000

// ── slots ───────────────────────────────────────────────────────────────────

interface Settings { workStart: string; workEnd: string; windows: Array<[string, string]>; maxPerDay: number }

async function settings(): Promise<Settings> {
  const { data } = await db().from('profiles').select('work_start, work_end, meeting_windows, max_meetings_per_day').eq('id', 1).single()
  const windows = String(data?.meeting_windows ?? '11:00-13:00,16:00-18:00').split(',')
    .map(w => w.trim().split('-').map(x => x.trim()) as [string, string])
    .filter(w => /^\d{1,2}:\d{2}$/.test(w[0]) && /^\d{1,2}:\d{2}$/.test(w[1] ?? ''))
  return {
    workStart: data?.work_start ?? '10:00',
    workEnd: data?.work_end ?? '19:00',
    windows: windows.length ? windows : [['11:00', '13:00'], ['16:00', '18:00']],
    maxPerDay: Number(data?.max_meetings_per_day ?? 3),
  }
}

const at = (day: Date, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d
}

/**
 * The first free slot of `duration` minutes from `from`: inside a meeting
 * window, 10 minutes clear of other meetings, under the daily limit, not on
 * Sunday. Pure, so it is tested directly.
 */
export function findSlot(args: {
  from: Date
  durationMin: number
  windows: Array<[string, string]>
  maxPerDay: number
  busy: Array<{ start: Date; durationMin: number }>
  horizonDays?: number
}): Date | null {
  const buffer = 10 * MIN
  for (let i = 0; i < (args.horizonDays ?? 14); i++) {
    const day = new Date(args.from)
    day.setDate(day.getDate() + i)
    day.setHours(0, 0, 0, 0)
    if (day.getDay() === 0) continue
    const sameDay = args.busy.filter(b => b.start.toDateString() === day.toDateString())
    if (sameDay.length >= args.maxPerDay) continue
    for (const [a, b] of args.windows) {
      for (let t = at(day, a).getTime(); t + args.durationMin * MIN <= at(day, b).getTime(); t += 15 * MIN) {
        if (t < args.from.getTime()) continue
        const end = t + args.durationMin * MIN
        const clash = sameDay.some(m => {
          const s = m.start.getTime(), e = s + m.durationMin * MIN
          return t < e + buffer && end + buffer > s
        })
        if (!clash) return new Date(t)
      }
    }
  }
  return null
}

async function busyFrom(from: Date) {
  const { data } = await db().from('meetings').select('scheduled_at, duration_min')
    .in('status', ['scheduled', 'in_progress']).gte('scheduled_at', new Date(from.getTime() - 86400_000).toISOString())
  return (data ?? []).map(m => ({ start: new Date(m.scheduled_at as string), durationMin: Number(m.duration_min) }))
}

// ── booking ─────────────────────────────────────────────────────────────────

export async function bookMeeting(args: {
  execs: ExecKey[]
  productId: string | null
  kind: 'decision' | 'one_on_one' | 'staff' | 'review' | 'customer'
  topic: string
  items: string[]
  durationMin?: number
  earliest?: Date
  nightId?: string | null
  createdBy?: string
  signal?: AbortSignal
  /** The exact reports behind the items, when they span products. */
  reportsFor?: Array<{ exec: ExecKey; productId: string | null }>
}): Promise<{ id: string; scheduledAt: Date } | null> {
  const s = await settings()
  const duration = [15, 20, 30, 45].includes(args.durationMin ?? 0) ? args.durationMin! : 20
  const from = new Date(Math.max(Date.now() + 30 * MIN, args.earliest?.getTime() ?? 0))
  const slot = findSlot({ from, durationMin: duration, windows: s.windows, maxPerDay: s.maxPerDay, busy: await busyFrom(from) })
  if (!slot) return null

  await applyModelSettings()
  const ctx = await workContext(args.productId)
  const reports = args.reportsFor?.length ? await reportsFor(args.reportsFor) : await latestReports(args.execs, args.productId)
  const { data: agenda } = await generateObject({ agent: 'ea', signal: args.signal }, {
    system: systemFor('ea'),
    prompt: `Prepare a ${duration}-minute ${args.kind.replace('_', ' ')} meeting between the founder and ${args.execs.map(e => EXECS[e].title).join(', ')}.
Topic: ${args.topic}

WHAT NEEDS THE FOUNDER:
${args.items.map(i => `- ${i}`).join('\n') || '- (general)'}

THE EXECS' LATEST REPORTS:
${reports}

${ctx.text}

Write the agenda (decisions first, at most 5 items) and a pre-read the founder can absorb in 3 minutes: the facts, the options and each exec's recommendation.`,
    schema: AgendaSchema,
    purpose: 'agenda',
  })

  const { data, error } = await db().from('meetings').insert({
    title: agenda.title,
    kind: args.kind,
    execs: args.execs,
    product_id: args.productId,
    purpose: agenda.purpose,
    agenda: agenda.agenda,
    pre_read: agenda.pre_read,
    scheduled_at: slot.toISOString(),
    duration_min: duration,
    created_by: args.createdBy ?? 'ea',
    night_id: args.nightId ?? null,
  }).select('id').single()
  if (error) throw new Error(`Could not save the meeting: ${error.message}`)
  await post({
    speaker: 'ea', kind: 'meeting', to: args.execs, meetingId: data.id as string, productId: args.productId,
    content: `Booked “${agenda.title}” with the founder for ${slot.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} (${duration} min). Pre-read is up.`,
  })
  await syncToCalendar(data.id as string)
  return { id: data.id as string, scheduledAt: slot }
}

/** The latest report for each exact (exec, product) pair. */
async function reportsFor(pairs: Array<{ exec: ExecKey; productId: string | null }>): Promise<string> {
  const { data: products } = await db().from('products').select('id, name')
  const name = new Map((products ?? []).map(p => [p.id as string, p.name as string]))
  const seen = new Set<string>()
  const rows = await Promise.all(pairs.filter(p => {
    const k = `${p.exec}|${p.productId}`
    return seen.has(k) ? false : (seen.add(k), true)
  }).map(async ({ exec, productId }) => {
    let q = db().from('exec_reports').select('report').eq('exec', exec).order('created_at', { ascending: false }).limit(1)
    q = productId ? q.eq('product_id', productId) : q.is('product_id', null)
    const { data } = await q.maybeSingle()
    const label = `${EXECS[exec].title} · ${productId ? name.get(productId) ?? 'product' : 'portfolio'}`
    return data ? `### ${label}\n${JSON.stringify(data.report)}` : `### ${label}\n(no report yet)`
  }))
  return rows.join('\n\n')
}

async function latestReports(execs: ExecKey[], productId: string | null): Promise<string> {
  const rows = await Promise.all(execs.map(async e => {
    let q = db().from('exec_reports').select('report').eq('exec', e).order('created_at', { ascending: false }).limit(1)
    q = productId && EXECS[e].scope === 'product' ? q.eq('product_id', productId) : q
    const { data } = await q.maybeSingle()
    return data ? `### ${EXECS[e].title}\n${JSON.stringify(data.report)}` : `### ${EXECS[e].title}\n(no report yet)`
  }))
  return rows.join('\n\n')
}

/** Put a meeting on the Mac Calendar. A failure is recorded, never fatal, and retried later. */
export async function syncToCalendar(meetingId: string) {
  if (!calendarEnabled()) return
  const supabase = db()
  const { data: m } = await supabase.from('meetings').select('*').eq('id', meetingId).single()
  if (!m || m.calendar_uid || m.status !== 'scheduled') return
  try {
    const uid = await addEvent({
      title: `MarkOS · ${m.title}`,
      notes: `${m.purpose ?? ''}\n\nAgenda:\n${(m.agenda as Array<{ item: string }>).map(a => `• ${a.item}`).join('\n')}\n\nOpen the meeting room: http://localhost:3001/meetings/${m.id}`,
      url: `http://localhost:3001/meetings/${m.id}`,
      start: new Date(m.scheduled_at as string),
      durationMin: Number(m.duration_min),
    })
    await supabase.from('meetings').update({ calendar_uid: uid, calendar_error: null }).eq('id', meetingId)
  } catch (err) {
    await supabase.from('meetings').update({ calendar_error: (err as Error).message }).eq('id', meetingId)
  }
}

/** Retry calendar sync for meetings that missed it (e.g. booked at night before macOS allowed it). */
export async function retryCalendarSync() {
  if (!calendarEnabled()) return
  const { data } = await db().from('meetings').select('id').eq('status', 'scheduled').is('calendar_uid', null)
    .gte('scheduled_at', new Date().toISOString()).limit(10)
  for (const m of data ?? []) await syncToCalendar(m.id as string)
}

export async function cancelMeeting(meetingId: string, opts: { quiet?: boolean } = {}) {
  const { data: m } = await db().from('meetings').select('calendar_uid, title, execs, scheduled_at').eq('id', meetingId).single()
  if (m && !opts.quiet) {
    await post({ speaker: 'ea', kind: 'meeting', to: m.execs as string[], meetingId, content: `Cancelled “${m.title}” (was ${new Date(m.scheduled_at as string).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}).` })
  }
  const removed = m?.calendar_uid ? await removeEvent(m.calendar_uid as string) : true
  await db().from('meetings').update({
    status: 'cancelled', updated_at: new Date().toISOString(),
    calendar_error: removed ? null : 'Cancelled here, but the event could not be removed from your Calendar — delete it there.',
  }).eq('id', meetingId)
}

export async function rescheduleMeeting(meetingId: string) {
  const supabase = db()
  const { data: m } = await supabase.from('meetings').select('*').eq('id', meetingId).single()
  if (!m) throw new Error('Meeting not found')
  if (m.calendar_uid) await removeEvent(m.calendar_uid as string)
  const s = await settings()
  const from = new Date(Math.max(Date.now() + 30 * MIN, new Date(m.scheduled_at as string).getTime() + 60 * MIN))
  const busy = (await busyFrom(from)).filter(b => b.start.getTime() !== new Date(m.scheduled_at as string).getTime())
  const slot = findSlot({ from, durationMin: Number(m.duration_min), windows: s.windows, maxPerDay: s.maxPerDay, busy })
  if (!slot) throw new Error('No free slot in the next two weeks — widen your meeting windows in Settings.')
  await supabase.from('meetings').update({ scheduled_at: slot.toISOString(), calendar_uid: null, calendar_error: null, updated_at: new Date().toISOString() }).eq('id', meetingId)
  await syncToCalendar(meetingId)
  return slot
}

/**
 * Another agent wants the founder's time. If a decision meeting is already
 * coming up in the next three days, the item joins its agenda instead of a
 * new meeting being booked — the founder's calendar stays at one a day.
 */
export async function addToUpcomingDecisionMeeting(item: string, owner: string): Promise<{ id: string; title: string; at: string } | null> {
  const { data: m } = await db().from('meetings').select('id, title, agenda, scheduled_at').eq('status', 'scheduled').eq('kind', 'decision')
    .gte('scheduled_at', new Date().toISOString()).lte('scheduled_at', new Date(Date.now() + 3 * 86400_000).toISOString())
    .order('scheduled_at').limit(1).maybeSingle()
  if (!m) return null
  const agenda = [...(m.agenda as Array<{ item: string; owner: string; decision_needed: boolean }>), { item, owner, decision_needed: true }]
  const { error } = await db().from('meetings').update({ agenda, updated_at: new Date().toISOString() }).eq('id', m.id)
  if (error) throw new Error(`Could not update the agenda: ${error.message}`)
  return { id: m.id as string, title: m.title as string, at: m.scheduled_at as string }
}

/** The founder asked for a meeting in words ("set up time with the CFO about pricing"). */
export async function bookFromRequest(text: string, signal?: AbortSignal) {
  await applyModelSettings()
  const products = await portfolio()
  const { data: req } = await generateObject({ agent: 'ea', signal }, {
    system: systemFor('ea'),
    prompt: `PRODUCTS:\n${renderPortfolio(products)}\n\nTEAM: ${EXEC_KEYS.filter(k => k !== 'ea').map(k => `${k} (${EXECS[k].title})`).join(', ')}\n\nToday is ${new Date().toISOString().slice(0, 10)}. The founder asked: """${text}"""\nWork out who should be in the meeting, about what, and for how long.`,
    schema: MeetingRequestSchema,
    purpose: 'meeting request',
  })
  const productId = req.product ? products.find(p => p.name.toLowerCase() === req.product!.toLowerCase())?.id ?? null : null
  const execs = req.execs.filter(e => e !== 'ea')
  return bookMeeting({
    execs: execs.length ? execs : ['coo'], productId, kind: req.kind, topic: req.topic, items: [req.topic],
    durationMin: req.duration_min, earliest: req.earliest ? new Date(`${req.earliest}T00:00:00`) : undefined,
    createdBy: 'founder', signal,
  })
}

// ── the night's scheduling ──────────────────────────────────────────────────

/**
 * After the reports: book what truly needs the founder — a weekly staff
 * meeting early in the week, and at most one decision meeting a day covering
 * the five most important open decisions. Everything else stays written.
 */
export async function planMeetings(nightId: string, signal?: AbortSignal): Promise<string[]> {
  const supabase = db()
  const { data: reports } = await supabase.from('exec_reports').select('exec, product_id, report').eq('night_id', nightId)
  const { data: upcoming } = await supabase.from('meetings').select('execs, product_id, kind, scheduled_at')
    .eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString())
  const booked: string[] = []

  // Weekly staff meeting: the first working day of the week, if none is booked this week.
  const now = new Date()
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0)
  const { count: staffThisWeek } = await supabase.from('meetings').select('id', { count: 'exact', head: true })
    .eq('kind', 'staff').gte('scheduled_at', weekStart.toISOString()).neq('status', 'cancelled')
  if (!staffThisWeek && now.getDay() >= 1 && now.getDay() <= 2) {
    const m = await bookMeeting({
      execs: ['cmo', 'cfo', 'cpo', 'cto', 'sales', 'coo'], productId: null, kind: 'staff', durationMin: 30,
      topic: 'Weekly staff meeting: the scoreboard, each exec’s one move, conflicts', items: ['Scoreboard', 'One move per exec', 'Conflicts and asks'],
      nightId, signal,
    })
    if (m) booked.push(m.id)
  }

  // One decision meeting a day, at most: the five most important open
  // decisions, spread across execs so nothing important hides behind one
  // busy area. Everything else stays written, in the Inbox and the brief.
  const pendingDecision = (upcoming ?? []).some(m => m.kind === 'decision' &&
    Date.parse(m.scheduled_at as string) - Date.now() < 2 * 86400_000)
  if (pendingDecision) return booked

  const { data: productRows } = await supabase.from('products').select('id, name')
  const productName = new Map((productRows ?? []).map(p => [p.id as string, p.name as string]))
  const byExec = (reports ?? []).map(r => {
    const rep = r.report as ExecReport
    const where = r.product_id ? `[${productName.get(r.product_id as string) ?? 'product'}] ` : ''
    return {
      exec: r.exec as ExecKey,
      productId: (r.product_id as string | null) ?? null,
      items: [
        ...rep.decisions_needed.map(d => `${where}Decide: ${d.question} (recommends: ${d.recommendation})`),
        ...(rep.moves ?? []).filter(m => m.mode === 'needs_your_ok').map(m => `${where}Approve: ${m.move}`),
      ],
    }
  }).filter(n => n.items.length > 0 && n.exec !== 'ea')
  if (byExec.length === 0) return booked

  // Round-robin: the top item from each exec first, then the next, up to five.
  const picked: Array<{ exec: ExecKey; productId: string | null; item: string }> = []
  for (let round = 0; picked.length < 5 && byExec.some(n => n.items[round]); round++) {
    for (const n of byExec) if (n.items[round] && picked.length < 5 && !picked.some(p => p.item === n.items[round])) picked.push({ exec: n.exec, productId: n.productId, item: n.items[round] })
  }
  const execs = [...new Set(picked.map(p => p.exec))].slice(0, 4)
  const m = await bookMeeting({
    execs, productId: null, kind: 'decision', durationMin: 30,
    topic: 'Today’s decisions — the five that matter most',
    items: picked.map(p => `${EXECS[p.exec].title}: ${p.item}`),
    reportsFor: picked.map(p => ({ exec: p.exec, productId: p.productId })),
    nightId, signal,
  })
  if (m) booked.push(m.id)
  return booked
}

// ── the meeting room ────────────────────────────────────────────────────────

export async function sayInMeeting(meetingId: string, text: string) {
  const supabase = db()
  const clean = text.trim().slice(0, 4000)
  if (!clean) throw new Error('Say something first')
  const { data: m } = await supabase.from('meetings').select('*').eq('id', meetingId).single()
  if (!m) throw new Error('Meeting not found')
  if (m.status === 'done' || m.status === 'cancelled') throw new Error('This meeting has ended')
  await supabase.from('meeting_messages').insert({ meeting_id: meetingId, speaker: 'founder', content: clean })
  if (m.status === 'scheduled') await supabase.from('meetings').update({ status: 'in_progress' }).eq('id', meetingId)

  await applyModelSettings()
  const execs = (m.execs as ExecKey[]).filter(e => EXECS[e])
  const [{ data: transcript }, ctx, reports] = await Promise.all([
    supabase.from('meeting_messages').select('speaker, content').eq('meeting_id', meetingId).order('created_at').limit(60),
    workContext(m.product_id as string | null),
    latestReports(execs, m.product_id as string | null),
  ])
  const { data: turn } = await generateObject({ agent: execs[0] ?? 'coo', productId: m.product_id as string | null }, {
    system: `You are in a meeting with the founder. Speak as ${execs.map(e => EXECS[e].title).join(' and ')}, each in their own role and skill:\n\n${execs.map(e => systemFor(e)).join('\n\n---\n\n')}`,
    prompt: `MEETING: ${m.title} — ${m.purpose ?? ''}
AGENDA:\n${(m.agenda as Array<{ item: string }>).map(a => `- ${a.item}`).join('\n')}
PRE-READ:\n${m.pre_read ?? ''}

YOUR LATEST REPORTS:\n${reports}

${ctx.text}

TRANSCRIPT SO FAR:\n${(transcript ?? []).map(t => `${t.speaker === 'founder' ? 'Founder' : EXECS[t.speaker as ExecKey]?.title ?? t.speaker}: ${t.content}`).join('\n')}

Answer the founder's last message. Be direct and specific; recommend, don't hedge. If the founder decides something, confirm it in one line and say what you'll do next.`,
    schema: MeetingTurnSchema,
    purpose: 'meeting',
  })
  const replies = turn.replies.filter(r => execs.includes(r.speaker)).slice(0, 3)
  if (replies.length) {
    await supabase.from('meeting_messages').insert(replies.map(r => ({ meeting_id: meetingId, speaker: r.speaker, content: r.text })))
  }
  return replies
}

/** End the meeting: minutes, decisions, and every action item as a dated task. */
export async function endMeeting(meetingId: string) {
  const supabase = db()
  const { data: m } = await supabase.from('meetings').select('*').eq('id', meetingId).single()
  if (!m) throw new Error('Meeting not found')
  const { data: transcript } = await supabase.from('meeting_messages').select('speaker, content').eq('meeting_id', meetingId).order('created_at')
  if (!transcript?.length) {
    await supabase.from('meetings').update({ status: 'missed', updated_at: new Date().toISOString() }).eq('id', meetingId)
    return null
  }
  await applyModelSettings()
  const products = await portfolio()
  const { data: minutes } = await generateObject({ agent: 'ea' }, {
    system: systemFor('ea'),
    prompt: `Write the minutes of this meeting. Record only what was actually said or decided. Every action item gets one owner (an exec key, or "founder") and a due date (default: within 3 working days of ${new Date().toISOString().slice(0, 10)}).

PRODUCTS:\n${renderPortfolio(products)}
MEETING: ${m.title}
AGENDA:\n${(m.agenda as Array<{ item: string }>).map(a => `- ${a.item}`).join('\n')}
TRANSCRIPT:\n${transcript.map(t => `${t.speaker === 'founder' ? 'Founder' : EXECS[t.speaker as ExecKey]?.title ?? t.speaker}: ${t.content}`).join('\n')}`,
    schema: MinutesSchema,
    purpose: 'minutes',
  })

  const byName = new Map(products.map(p => [p.name.toLowerCase(), p.id]))
  const productOf = (name: string | null) => (name ? byName.get(name.toLowerCase()) ?? null : (m.product_id as string | null))
  // The founder's decisions in a meeting carry the founder's authority: these tasks can hand work on.
  await createTasks(minutes.action_items.filter(a => a.owner !== 'founder' && a.owner !== 'ea').map(a => ({
    exec: a.owner as ExecKey, productId: productOf(a.product), task: a.task, due: a.due,
    why: `Agreed in “${m.title}”`, origin: 'founder',
  })))
  // The founder's own action items: tracked by the EA, never executed by an agent.
  const founderItems = minutes.action_items.filter(a => a.owner === 'founder')
  if (founderItems.length) {
    const { error } = await supabase.from('tasks').insert(founderItems.map(a => ({
      exec: 'founder', product_id: productOf(a.product), task: a.task,
      due: a.due && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null, why: `You agreed in “${m.title}”`, origin: 'meeting',
    })))
    if (error) throw new Error(`Could not save your action items: ${error.message}`)
  }
  await supabase.from('meetings').update({ status: 'done', minutes, updated_at: new Date().toISOString() }).eq('id', meetingId)
  return minutes
}

/** Meetings whose time passed without anyone opening them. */
export async function markMissedMeetings() {
  await db().from('meetings').update({ status: 'missed', updated_at: new Date().toISOString() })
    .eq('status', 'scheduled').lt('scheduled_at', new Date(Date.now() - 6 * 3600_000).toISOString())
}

/** Cancel Myra's upcoming decision meetings and plan again from the latest night's reports. */
export async function replanMeetings(signal?: AbortSignal): Promise<string[]> {
  const supabase = db()
  const { data: night } = await supabase.from('nights').select('id').not('brief', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!night) return []
  const { data: mine } = await supabase.from('meetings').select('id').eq('status', 'scheduled').eq('kind', 'decision').eq('created_by', 'ea')
    .gte('scheduled_at', new Date().toISOString())
  for (const m of mine ?? []) await cancelMeeting(m.id as string, { quiet: true })
  const booked = await planMeetings(night.id as string, signal)
  if ((mine ?? []).length) {
    await post({ speaker: 'ea', kind: 'meeting', content: `Replanned the calendar: ${(mine ?? []).length} earlier decision meeting(s) are cancelled${booked.length ? ' and replaced by the one now booked' : ''}. Ignore any times mentioned before this message.` })
  }
  return booked
}
