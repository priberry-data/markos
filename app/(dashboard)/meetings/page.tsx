import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, PageHeader, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { EXEC_LABELS } from '@/lib/engine/execs/people'
import { BookMeeting, MeetingActions, RetryCalendar, TodoRow } from '@/components/execs/office-client'
import { when } from '@/lib/utils/when'

export const dynamic = 'force-dynamic'

const STATUS = { scheduled: 'violet', in_progress: 'green', done: 'default', cancelled: 'default', missed: 'red' } as const

export default async function MeetingsPage() {
  const supabase = db()
  const [{ data: upcoming }, { data: past }, { data: todos }] = await Promise.all([
    supabase.from('meetings').select('*').in('status', ['scheduled', 'in_progress']).order('scheduled_at'),
    supabase.from('meetings').select('*').in('status', ['done', 'missed']).order('scheduled_at', { ascending: false }).limit(10),
    supabase.from('tasks').select('id, task, due, why').eq('exec', 'founder').eq('status', 'queued').order('due', { nullsFirst: false }),
  ])
  return (
    <div className="p-8 max-w-4xl space-y-6">
      <PageHeader icon={CalendarDays} title="Meetings"
        subtitle="Myra books time with the team only when something needs you, inside your meeting windows, and on a Mac puts it on your Calendar app too." />
      <Card><SectionTitle>Ask Myra for a meeting</SectionTitle><BookMeeting /></Card>

      <Card>
        <SectionTitle>Coming up</SectionTitle>
        {(upcoming ?? []).length === 0 ? <p className={tone.muted}>Nothing booked. Your calendar is clear.</p> : (
          <div className="space-y-2">{(upcoming ?? []).map(m => <MeetingRow key={m.id} m={m} />)}</div>
        )}
      </Card>

      <Card>
        <SectionTitle>Your action items</SectionTitle>
        {(todos ?? []).length === 0 ? <p className={tone.muted}>Nothing on your list.</p> : (
          <div className="space-y-2">{(todos ?? []).map(t => <TodoRow key={t.id} id={t.id} task={t.task} due={t.due} why={t.why} />)}</div>
        )}
      </Card>

      {(past ?? []).length > 0 && (
        <Card><SectionTitle>Past meetings</SectionTitle><div className="space-y-2">{(past ?? []).map(m => <MeetingRow key={m.id} m={m} />)}</div></Card>
      )}
    </div>
  )
}

function MeetingRow({ m }: { m: Record<string, unknown> }) {
  const status = m.status as keyof typeof STATUS
  return (
    <div className={`${tone.inset} px-4 py-3 flex flex-wrap items-center gap-3`}>
      <div className="flex-1 min-w-[240px]">
        <Link href={`/meetings/${m.id}`} className="text-sm text-mk-text hover:text-mk-accent-soft">{m.title as string}</Link>
        <p className="text-xs text-mk-muted mt-0.5">
          {when(m.scheduled_at as string)} · {m.duration_min as number} min · with {(m.execs as string[]).map(e => EXEC_LABELS[e] ?? e).join(', ')}
          {m.calendar_error ? <span className="text-mk-warn"> · not on your calendar yet <RetryCalendar /></span> : m.calendar_uid ? ' · on your calendar' : ''}
        </p>
      </div>
      <Pill color={STATUS[status] ?? 'default'}>{String(m.status).replace('_', ' ')}</Pill>
      <MeetingActions id={m.id as string} status={m.status as string} />
    </div>
  )
}
