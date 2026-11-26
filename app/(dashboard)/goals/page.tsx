import { Target } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, PageHeader, SectionTitle, tone } from '@/components/engine/ui'
import { AddGoal, ConfirmGoals, GoalRow, ProposeGoals } from '@/components/execs/goals-client'
import { listGoals } from '@/lib/engine/execs/goals'

export const dynamic = 'force-dynamic'

// What the company is working toward. Every agent reads these before it works.
export default async function GoalsPage() {
  const [goals, done, { data: products }] = await Promise.all([
    listGoals(['active', 'proposed']),
    listGoals(['achieved']),
    db().from('products').select('id, name').eq('status', 'active').order('created_at'),
  ])
  const name = new Map((products ?? []).map(p => [p.id as string, p.name as string]))
  const proposed = goals.some(g => g.status === 'proposed')
  return (
    <div className="p-8 max-w-3xl space-y-5">
      <PageHeader icon={Target} title="Goals"
        subtitle="What the whole team is working toward. Every agent reads these before it does anything, and the morning brief tracks them." />
      {goals.length === 0 ? (
        <Card className="text-center space-y-3 py-10">
          <p className="text-mk-text font-medium">No goals yet</p>
          <p className={tone.muted}>Your Chief of Staff can draft them from your products’ own docs — you confirm or change them.</p>
          <ProposeGoals />
        </Card>
      ) : (
        <>
          {proposed && (
            <div className="bg-mk-warn/10 border border-mk-warn/30 rounded-2xl px-5 py-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-mk-body flex-1 min-w-[240px]">Your Chief of Staff drafted these from your docs. Change anything below, then confirm — until you do, the team treats them as proposals.</p>
              <ConfirmGoals />
            </div>
          )}
          <div className="space-y-2">{goals.map(g => <GoalRow key={g.id} g={g} productName={g.product_id ? name.get(g.product_id) ?? null : null} />)}</div>
          <div className="flex justify-end"><ProposeGoals again /></div>
        </>
      )}
      <Card><SectionTitle>Add a goal</SectionTitle><AddGoal products={(products ?? []).map(p => ({ id: p.id as string, name: p.name as string }))} /></Card>
      {done.length > 0 && <p className={tone.muted}>{done.length} goal(s) achieved.</p>}
    </div>
  )
}
