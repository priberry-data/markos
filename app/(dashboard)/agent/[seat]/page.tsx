import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, SectionTitle, tone } from '@/components/engine/ui'
import { AutoRefresh, TaskRow, type TaskView } from '@/components/execs/brief-client'
import { Avatar } from '@/components/execs/team-card'
import { ReportCard } from '@/components/execs/report-card'
import { PEOPLE } from '@/lib/engine/execs/people'
import { CAPABILITIES, ROLES } from '@/lib/engine/execs/roles'
import { SEATS, teamStatus, type SeatKey } from '@/lib/engine/execs/team-status'
import type { ExecReport, TaskResult } from '@/lib/engine/schemas'

export const dynamic = 'force-dynamic'

// One team member's desk: who they are, what they're doing, what they've
// reported and what they've finished — and a way to talk to them.

export default async function AgentPage({ params }: { params: Promise<{ seat: string }> }) {
  const { seat } = await params
  if (!(SEATS as readonly string[]).includes(seat)) notFound()
  const supabase = db()
  const role = ROLES.find(r => r.key === seat)!
  const caps = CAPABILITIES[seat]
  const leadsName = seat === 'cmo' ? 'CMO' : seat === 'cto' ? 'CTO' : seat === 'coo' ? 'COO' : null
  const team = leadsName ? ROLES.filter(r => (r.group === 'teams' || r.group === 'marketing') && r.reportsTo === leadsName) : []
  const { data: outputs } = team.some(t => t.group === 'marketing')
    ? await supabase.from('agent_outputs').select('agent_name, product_id, created_at').in('status', ['current', 'draft']).order('created_at', { ascending: false }).limit(200)
    : { data: [] as Array<{ agent_name: string; product_id: string; created_at: string }> }
  const [{ data: products }, { data: open }, { data: done }, { data: reports }, status] = await Promise.all([
    supabase.from('products').select('id, name'),
    supabase.from('tasks').select('*').eq('exec', seat).in('status', ['running', 'queued', 'failed']).order('created_at', { ascending: false }).limit(20),
    supabase.from('tasks').select('*').eq('exec', seat).eq('status', 'done').order('finished_at', { ascending: false }).limit(10),
    supabase.from('exec_reports').select('product_id, report, created_at').eq('exec', seat).order('created_at', { ascending: false }).limit(30),
    teamStatus(),
  ])
  const name = new Map((products ?? []).map(p => [p.id as string, p.name as string]))
  const view = (t: Record<string, unknown>): TaskView => ({
    id: t.id as string, exec: t.exec as string, product: t.product_id ? name.get(t.product_id as string) ?? null : null,
    task: t.task as string, status: t.status as string, origin: t.origin as string, result_summary: (t.result_summary as string) ?? null,
    deliverable: (t.result as TaskResult | null)?.deliverable ?? null, error_message: (t.error_message as string) ?? null,
  })
  // Latest report per product.
  const latest = new Map<string, { product_id: string | null; report: ExecReport; created_at: string }>()
  for (const r of reports ?? []) if (!latest.has(String(r.product_id))) latest.set(String(r.product_id), r as never)
  const s = status[seat as SeatKey]

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <AutoRefresh active={s.state === 'working'} every={6000} />
      <div className="flex flex-wrap items-center gap-4">
        <Avatar seat={seat} size={64} />
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-2xl font-bold text-mk-text">{PEOPLE[seat].name}</h1>
          <p className="text-mk-muted">{role.title} · reports to {role.reportsTo}</p>
          <p className={`text-sm mt-1 ${s.now ? 'text-mk-ok' : 'text-mk-body'}`}>{s.now ? `Working on: ${s.now}` : s.headline ?? 'Ready. Nothing assigned yet.'}</p>
        </div>
        <Link href={`/room?to=${seat}`} className={tone.primaryBtn}><MessageSquare className="w-4 h-4" /> Message {PEOPLE[seat].name}</Link>
      </div>

      <Card>
        <p className="text-mk-body">{role.purpose}</p>
        <div className="grid sm:grid-cols-2 gap-4 mt-4 text-sm">
          <div><p className={tone.label}>Responsibilities</p>{role.duties.map((d, i) => <p key={i} className="mt-1 text-mk-body">• {d}</p>)}</div>
          <div className="space-y-3">
            {caps && <div><p className={tone.label}>Can do on its own</p>{caps.actions.map((d, i) => <p key={i} className="mt-1 text-mk-ok">• {d}</p>)}</div>}
            <div><p className={tone.label}>Always comes to you</p>{role.needsYou.map((d, i) => <p key={i} className="mt-1 text-mk-warn">• {d}</p>)}</div>
          </div>
        </div>
        <Link href="/team" className="inline-block text-xs text-mk-accent hover:underline mt-4">Skills and playbook →</Link>
      </Card>

      {team.length > 0 && (
        <Card>
          <SectionTitle>{PEOPLE[seat].name}’s team</SectionTitle>
          <p className={`${tone.muted} -mt-2 mb-3`}>{seat === 'cmo'
            ? 'The CMO runs these specialists for each product. Research and strategy come first; you approve the strategy; then the rest work from it, and ARIA reviews their drafts before you see them.'
            : 'Reports to ' + PEOPLE[seat].name + '.'}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {team.map(t => {
              const last = (outputs ?? []).filter(o => o.agent_name === t.key)
              const desk = (SEATS as readonly string[]).includes(t.key)
              const body = (
                <div className={`${tone.inset} px-3 py-2.5 h-full`}>
                  <p className="text-sm text-mk-text font-medium">{t.name} <span className="text-xs text-mk-muted font-normal">· {t.title}</span></p>
                  <p className="text-xs text-mk-body mt-0.5">{t.purpose}</p>
                  <p className="text-[11px] text-mk-muted mt-1">{last.length
                    ? `Last produced: ${[...new Set(last.map(o => name.get(o.product_id as string)).filter(Boolean))].slice(0, 3).join(', ')} · ${new Date(last[0].created_at as string).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                    : desk ? 'Open their desk →' : 'Hasn’t produced anything yet'}</p>
                </div>
              )
              return desk ? <Link key={t.key} href={`/agent/${t.key}`}>{body}</Link> : <div key={t.key}>{body}</div>
            })}
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle>On the desk</SectionTitle>
        {(open ?? []).length === 0 ? <p className={tone.muted}>Nothing open. Message {PEOPLE[seat].name} to give them something.</p>
          : <div className="space-y-2">{(open ?? []).map(t => <TaskRow key={t.id} t={view(t)} />)}</div>}
      </Card>

      {latest.size > 0 && (
        <Card>
          <SectionTitle>Latest reports</SectionTitle>
          <div className="space-y-2">
            {[...latest.values()].map((r, i) => (
              <ReportCard key={i} open={i === 0} product={r.product_id ? name.get(r.product_id) ?? '' : 'Whole portfolio'} report={r.report} at={r.created_at} />
            ))}
          </div>
        </Card>
      )}

      {(done ?? []).length > 0 && (
        <Card>
          <SectionTitle>Finished recently</SectionTitle>
          <div className="space-y-2">{(done ?? []).map(t => <TaskRow key={t.id} t={view(t)} />)}</div>
        </Card>
      )}
    </div>
  )
}
