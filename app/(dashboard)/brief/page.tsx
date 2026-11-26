import Link from 'next/link'
import { AlertTriangle, ArrowRight, CalendarDays, Inbox, ListTodo, Target, TrendingUp, Zap } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { AutoRefresh, Collapsible, NightControls, TaskRow, type TaskView } from '@/components/execs/brief-client'
import { CommandBox } from '@/components/execs/command-box'
import { TeamCard } from '@/components/execs/team-card'
import { GoalsStrip } from '@/components/execs/goals-strip'
import { listGoals } from '@/lib/engine/execs/goals'
import { EXEC_LABELS } from '@/lib/engine/execs/people'
import { inboxItems } from '@/lib/engine/execs/inbox'
import { SEATS, teamStatus } from '@/lib/engine/execs/team-status'
import { ROLES } from '@/lib/engine/execs/roles'
import type { MorningBrief, TaskResult } from '@/lib/engine/schemas'
import type { Analytics } from '@/lib/engine/execs/analytics'

export const dynamic = 'force-dynamic'

// Home: your team first. Who they are, what they're doing, what's waiting for
// you — then one box to tell them anything, and the morning brief.

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function HomePage() {
  const supabase = db()
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999)
  const [{ data: night }, { data: products }, { data: directives }, { data: profile }, status, inbox, { count: meetingsToday }, { count: todos }] = await Promise.all([
    supabase.from('nights').select('*').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('products').select('id, name').eq('status', 'active').order('created_at'),
    supabase.from('directives').select('*').order('created_at', { ascending: false }).limit(3),
    supabase.from('profiles').select('name').eq('id', 1).single(),
    teamStatus(),
    inboxItems(),
    supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString()).lte('scheduled_at', dayEnd.toISOString()),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('exec', 'founder').eq('status', 'queued'),
  ])
  const goals = await listGoals()
  const ids = (directives ?? []).map(d => d.id)
  const { data: dTasks } = ids.length ? await supabase.from('tasks').select('*').in('directive_id', ids) : { data: [] }
  const name = new Map((products ?? []).map(p => [p.id as string, p.name as string]))
  const view = (t: Record<string, unknown>): TaskView => ({
    id: t.id as string, exec: t.exec as string, product: t.product_id ? name.get(t.product_id as string) ?? null : null,
    task: t.task as string, status: t.status as string, origin: t.origin as string, result_summary: (t.result_summary as string) ?? null,
    deliverable: (t.result as TaskResult | null)?.deliverable ?? null, error_message: (t.error_message as string) ?? null,
  })

  // The brief and scoreboard come from the latest night that produced one —
  // a shift that is running now (or was cut short) doesn't hide yesterday's.
  const { data: briefNight } = night?.brief ? { data: night } : await supabase.from('nights').select('brief, analytics')
    .not('brief', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle()
  const brief = briefNight?.brief as MorningBrief | null
  const board = (briefNight?.analytics as { portfolio?: Analytics } | null)?.portfolio ?? null
  const running = night?.status === 'running'
  const busy = running || Object.values(status).some(s => s.state === 'working') || (directives ?? []).some(d => d.status === 'routing')
  const log = (night?.log ?? []) as Array<{ step: string }>
  const inboxCount = inbox.reduce((n, i) => n + i.count, 0)
  const first = (profile?.name as string | null)?.split(' ')[0]

  return (
    <div className="p-8 max-w-6xl space-y-8">
      <AutoRefresh active={busy} every={6000} />

      {/* Greeting and the one line that matters */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-mk-text">{greeting()}{first ? `, ${first}` : ''}</h1>
          <p className="text-mk-muted mt-1">
            {running ? <>Your team is working through the night shift — {log[log.length - 1]?.step ?? 'starting'}.</>
              : brief ? brief.headline
                : 'Your team is ready. Tell them what you need, or run the night shift to get your first brief.'}
          </p>
        </div>
        <NightControls running={running} />
      </div>

      {/* What we're working toward */}
      <GoalsStrip goals={goals} products={name} />

      {/* What needs you */}
      <div className="grid sm:grid-cols-3 gap-3">
        <BigLink href="/inbox" icon={Inbox} n={inboxCount} label={inboxCount === 1 ? 'thing waiting for you' : 'things waiting for you'} accent={inboxCount > 0} />
        <BigLink href="/meetings" icon={CalendarDays} n={meetingsToday ?? 0} label={meetingsToday === 1 ? 'meeting today' : 'meetings today'} />
        <BigLink href="/meetings" icon={ListTodo} n={todos ?? 0} label={todos === 1 ? 'action item for you' : 'action items for you'} />
      </div>

      {/* Your team */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <h2 className="text-lg font-semibold text-mk-text">Your team</h2>
          <Link href="/room" className="text-sm text-mk-accent hover:underline">Open the team room →</Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {SEATS.map(seat => {
            const me = ROLES.find(r => r.key === seat)
            const leads = ROLES.filter(r => (r.group === 'teams' || r.group === 'marketing') && r.reportsTo === (seat === 'cmo' ? 'CMO' : seat === 'cto' ? 'CTO' : seat === 'coo' ? 'COO' : '—')).map(r => r.name)
            return <TeamCard key={seat} s={status[seat]} role={me?.title ?? ''} leads={leads} />
          })}
        </div>
      </section>

      {/* One box for everything */}
      <Card>
        <SectionTitle>Tell the team</SectionTitle>
        <CommandBox products={(products ?? []).map(p => ({ id: p.id as string, name: p.name as string }))} />
        {(directives ?? []).length > 0 && (
          <div className="mt-5 space-y-4">
            {(directives ?? []).map(d => (
              <div key={d.id} className="space-y-2">
                <p className="text-xs text-mk-muted">
                  You said: “{d.text}”
                  {d.status === 'routing' && <span className="text-mk-accent-soft"> · routing…</span>}
                  {d.status === 'failed' && <span className="text-mk-bad"> · {d.error_message}</span>}
                </p>
                {d.clarify && <p className="text-xs text-mk-warn">Question for you: {d.clarify}</p>}
                <div className="space-y-2">{(dTasks ?? []).filter(t => t.directive_id === d.id).map(t => <TaskRow key={t.id} t={view(t)} />)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* The morning brief */}
      {brief && (
        <Card className="space-y-5">
          <SectionTitle>Morning brief <span className="text-xs font-normal text-mk-muted">· from your Chief of Staff</span></SectionTitle>
          {brief.the_one_thing && (
            <div className="bg-mk-accent/10 border border-mk-accent/30 rounded-xl px-4 py-3">
              <p className="text-xs uppercase tracking-wider text-mk-accent-soft flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> The one thing today{brief.the_one_thing.product ? ` · ${brief.the_one_thing.product}` : ''}</p>
              <p className="text-mk-text mt-1">{brief.the_one_thing.focus}</p>
              <p className="text-xs text-mk-muted mt-1">{brief.the_one_thing.why}</p>
            </div>
          )}
          {brief.top_decisions.length > 0 && (
            <div>
              <p className={tone.label}>Decisions for you</p>
              <ol className="mt-2 space-y-2">
                {brief.top_decisions.map((d, i) => (
                  <li key={i} className={`${tone.inset} px-4 py-3`}>
                    <p className="text-sm text-mk-text">{d.question}</p>
                    <p className="text-xs text-mk-muted mt-1">{EXEC_LABELS[d.exec]}{d.product ? ` · ${d.product}` : ''} recommends: <span className="text-mk-body">{d.recommendation}</span></p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {(brief.moves ?? []).length > 0 && (
            <div>
              <p className={tone.label}>Next moves</p>
              <div className="mt-2 space-y-1.5">
                {brief.moves.map((m, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Pill color={m.status === 'team_doing_it' ? 'green' : m.status === 'needs_your_ok' ? 'amber' : 'violet'}>
                      {m.status === 'team_doing_it' ? 'team is on it' : m.status === 'needs_your_ok' ? 'needs your OK' : 'needs your input'}
                    </Pill>
                    <span className="text-mk-body"><span className="text-mk-accent-soft">{EXEC_LABELS[m.exec]}{m.product ? ` · ${m.product}` : ''}:</span> {m.move}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {brief.today_focus.length > 0 && (
            <div>
              <p className={tone.label}>Your focus today</p>
              <ul className="mt-2 space-y-1">{brief.today_focus.map((f, i) => <li key={i} className={tone.body}>• {f}</li>)}</ul>
            </div>
          )}
          {brief.per_product.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brief.per_product.map((p, i) => (
                <div key={i} className={`${tone.inset} px-3 py-2 max-w-xs`}>
                  <div className="flex items-center gap-2"><span className="text-sm text-mk-text">{p.product}</span>
                    <Pill color={p.status === 'on_track' ? 'green' : p.status === 'attention' ? 'amber' : p.status === 'blocked' ? 'red' : 'default'}>{p.status.replace('_', ' ')}</Pill></div>
                  <p className="text-xs text-mk-muted mt-1">{p.note}</p>
                </div>
              ))}
            </div>
          )}
          {brief.overnight.length > 0 && (
            <Collapsible title={<span className={tone.label}>What happened overnight ({brief.overnight.length})</span>}>
              <ul className="space-y-1">{brief.overnight.map((o, i) => <li key={i} className={tone.body}>• {o.product ? <span className="text-mk-accent-soft">{o.product}: </span> : null}{o.summary}</li>)}</ul>
            </Collapsible>
          )}
          {brief.risks.length > 0 && (
            <div className="flex gap-2 items-start text-sm text-mk-warn"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{brief.risks.join(' · ')}</span></div>
          )}
        </Card>
      )}

      {board && <Scoreboard a={board} />}
    </div>
  )
}

function BigLink({ href, icon: Icon, n, label, accent }: { href: string; icon: typeof Inbox; n: number; label: string; accent?: boolean }) {
  return (
    <Link href={href} className={`group flex items-center gap-4 rounded-2xl border px-5 py-4 transition-all ${accent ? 'bg-mk-accent text-white border-mk-accent hover:opacity-95' : 'bg-mk-card border-mk-line hover:border-mk-accent/40'}`}>
      <Icon className={`w-6 h-6 ${accent ? 'text-white' : 'text-mk-accent'}`} />
      <div className="flex-1">
        <p className={`text-2xl font-bold leading-none ${accent ? 'text-white' : 'text-mk-text'}`}>{n}</p>
        <p className={`text-sm mt-1 ${accent ? 'text-white/90' : 'text-mk-muted'}`}>{label}</p>
      </div>
      <ArrowRight className={`w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform ${accent ? 'text-white' : 'text-mk-muted'}`} />
    </Link>
  )
}

function Scoreboard({ a }: { a: Analytics }) {
  const moving = a.trends.filter(t => t.thisWeek || t.lastWeek)
  return (
    <Card>
      <SectionTitle icon={TrendingUp}>Scoreboard <span className="text-xs font-normal text-mk-muted">· this week vs last, counted from real activity</span></SectionTitle>
      <div className="flex flex-wrap gap-2">
        {moving.length === 0 && <p className={tone.muted}>No activity in the last two weeks.</p>}
        {moving.map(t => (
          <div key={t.name} className={`${tone.inset} px-3 py-2 min-w-[140px]`}>
            <p className="text-[10px] text-mk-muted uppercase">{t.name}</p>
            <p className="text-lg text-mk-text">{t.thisWeek} <span className={`text-xs ${t.thisWeek > t.lastWeek ? 'text-mk-ok' : t.thisWeek < t.lastWeek ? 'text-mk-bad' : 'text-mk-muted'}`}>{t.thisWeek > t.lastWeek ? '↑' : t.thisWeek < t.lastWeek ? '↓' : '→'} {t.lastWeek}</span></p>
          </div>
        ))}
        {a.founderMetrics.map(m => (
          <div key={m.metric} className={`${tone.inset} px-3 py-2 min-w-[140px]`}>
            <p className="text-[10px] text-mk-muted uppercase">{m.metric}</p>
            <p className="text-lg text-mk-text">{m.latest}{m.previous !== null && <span className="text-xs text-mk-muted"> was {m.previous}</span>}</p>
          </div>
        ))}
      </div>
      {a.stalls.length > 0 && (
        <div className="mt-4">
          <p className={`${tone.label} flex items-center gap-1.5`}><Zap className="w-3.5 h-3.5 text-mk-warn" /> Not happening</p>
          <ul className="mt-1.5 space-y-0.5">{a.stalls.map((x, i) => <li key={i} className="text-sm text-mk-warn">• {x.what} — {x.days} days</li>)}</ul>
        </div>
      )}
    </Card>
  )
}
