import { notFound } from 'next/navigation'
import { CalendarDays } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, PageHeader, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { EXEC_LABELS } from '@/lib/engine/execs/people'
import { MeetingActions, MeetingRoom } from '@/components/execs/office-client'
import { when } from '@/lib/utils/when'
import type { Agenda, Minutes } from '@/lib/engine/schemas'

export const dynamic = 'force-dynamic'

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = db()
  const [{ data: m }, { data: lines }] = await Promise.all([
    supabase.from('meetings').select('*').eq('id', id).maybeSingle(),
    supabase.from('meeting_messages').select('speaker, content').eq('meeting_id', id).order('created_at'),
  ])
  if (!m) notFound()
  const minutes = m.minutes as Minutes | null
  return (
    <div className="p-8 max-w-4xl space-y-5">
      <PageHeader icon={CalendarDays} title={m.title}
        subtitle={<>{when(m.scheduled_at)} · {m.duration_min} min · with {(m.execs as string[]).map(e => EXEC_LABELS[e] ?? e).join(', ')}</>}
        actions={<MeetingActions id={m.id} status={m.status} />} />
      <Card>
        <p className={tone.body}>{m.purpose}</p>
        <div className="mt-3 space-y-1.5">
          {(m.agenda as Agenda['agenda']).map((a, i) => (
            <p key={i} className="text-sm text-mk-body">{i + 1}. {a.item} <span className="text-xs text-mk-muted">— {EXEC_LABELS[a.owner] ?? a.owner}</span> {a.decision_needed && <Pill color="amber">decision</Pill>}</p>
          ))}
        </div>
      </Card>
      {m.pre_read && <Card><SectionTitle>Pre-read</SectionTitle><pre className="whitespace-pre-wrap font-sans text-sm text-mk-body leading-relaxed">{m.pre_read}</pre></Card>}
      {minutes && (
        <Card>
          <SectionTitle>Minutes</SectionTitle>
          <p className={tone.body}>{minutes.summary}</p>
          {minutes.decisions.length > 0 && <div className="mt-3"><p className={tone.label}>Decisions</p>{minutes.decisions.map((d, i) => <p key={i} className="text-sm text-mk-body mt-1">• {d.decision} <span className="text-xs text-mk-muted">({d.by})</span></p>)}</div>}
          {minutes.action_items.length > 0 && <div className="mt-3"><p className={tone.label}>Action items (now tasks)</p>{minutes.action_items.map((a, i) => <p key={i} className="text-sm text-mk-body mt-1">• {EXEC_LABELS[a.owner] ?? (a.owner === 'founder' ? 'You' : a.owner)}: {a.task}{a.due ? ` — by ${a.due}` : ''}</p>)}</div>}
        </Card>
      )}
      <Card><SectionTitle>The room</SectionTitle><MeetingRoom id={m.id} status={m.status} lines={lines ?? []} /></Card>
    </div>
  )
}
