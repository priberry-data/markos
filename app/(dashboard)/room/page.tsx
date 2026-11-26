import { MessagesSquare } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader, tone } from '@/components/engine/ui'
import { Room, type RoomMessage } from '@/components/execs/room-client'
import { PEOPLE } from '@/lib/engine/execs/people'
import { ROLES } from '@/lib/engine/execs/roles'
import { GoalsStrip } from '@/components/execs/goals-strip'
import { listGoals } from '@/lib/engine/execs/goals'

export const dynamic = 'force-dynamic'

const MEMBERS = ['chief_of_staff', 'ea', 'cmo', 'cfo', 'data', 'cpo', 'cto', 'sales', 'coo', 'qa', 'platform', 'cx'] as const

export default async function RoomPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams
  const supabase = db()
  const [{ data }, { data: open }] = await Promise.all([
    supabase.from('team_messages').select('*').order('created_at', { ascending: false }).limit(150),
    supabase.from('tasks').select('exec, status').in('status', ['queued', 'running']),
  ])
  const goals = await listGoals()
  const { data: prods } = await supabase.from('products').select('id, name')
  const working = new Map<string, number>()
  for (const t of open ?? []) working.set(t.exec as string, (working.get(t.exec as string) ?? 0) + 1)
  return (
    <div className="p-8 max-w-6xl">
      <PageHeader icon={MessagesSquare} title="Team room"
        subtitle="Your whole team in one conversation. Watch them hand work to each other, ask each other, and report — and jump in any time." />
      <div className="mb-4"><GoalsStrip goals={goals} products={new Map((prods ?? []).map(p => [p.id as string, p.name as string]))} compact /></div>
      <div className="grid lg:grid-cols-[1fr_220px] gap-4">
        <Room initial={((data ?? []) as RoomMessage[]).reverse()} to={to ?? null} />
        <div className="space-y-1.5">
          <p className={tone.label}>In the room</p>
          {MEMBERS.map(k => {
            const role = ROLES.find(r => r.key === k)
            const n = working.get(k) ?? 0
            return (
              <div key={k} className={`${tone.inset} px-3 py-2 flex items-center gap-2`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PEOPLE[k].color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-mk-text truncate">{PEOPLE[k].name}</p>
                  <p className="text-[10px] text-mk-muted truncate">{role?.title}</p>
                </div>
                {n > 0 && <span className="text-[10px] text-mk-accent-soft" title="open tasks">{n} on desk</span>}
              </div>
            )
          })}
          <p className={`${tone.muted} pt-2`}>@mention someone to make sure they answer. Anyone can take on work, hand it on, or ask a teammate — nothing public happens without your OK.</p>
        </div>
      </div>
    </div>
  )
}
