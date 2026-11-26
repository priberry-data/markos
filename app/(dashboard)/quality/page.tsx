import { Bug } from 'lucide-react'
import { db } from '@/lib/db'
import { Card, PageHeader, Pill, SectionTitle, tone } from '@/components/engine/ui'
import { IssueStatus } from '@/components/execs/office-client'
import { getActiveProduct } from '@/lib/products/active'

export const dynamic = 'force-dynamic'

const SEV = { critical: 'red', high: 'red', medium: 'amber', low: 'default' } as const

export default async function QualityPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null
  const [{ data: issues }, { data: checks }] = await Promise.all([
    supabase.from('issues').select('*').eq('product_id', product.id).order('status').order('created_at', { ascending: false }).limit(80),
    supabase.from('qa_checks').select('url, status, ms, ok, problem, checked_at').eq('product_id', product.id).order('checked_at', { ascending: false }).limit(40),
  ])
  const latest = new Map<string, NonNullable<typeof checks>[number]>()
  for (const c of checks ?? []) if (!latest.has(c.url as string)) latest.set(c.url as string, c)
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const
  const open = (issues ?? []).filter(i => i.status === 'open').sort((a, b) => order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order])
  const closed = (issues ?? []).filter(i => i.status !== 'open')
  return (
    <div className="p-8 max-w-4xl space-y-6">
      <PageHeader icon={Bug} title="Quality" subtitle={`${product.name} · QA checks the live product every night, reads what changed, and files what's broken. Reports to the CTO.`} />
      <Card>
        <SectionTitle>Live pages</SectionTitle>
        {latest.size === 0 ? <p className={tone.muted}>Not checked yet — QA runs with the night shift.</p> : (
          <div className="space-y-1.5">
            {[...latest.values()].map(c => (
              <p key={c.url as string} className="text-sm text-mk-body flex flex-wrap gap-2 items-center">
                <Pill color={c.ok ? (c.problem ? 'amber' : 'green') : 'red'}>{c.ok ? (c.problem ? 'warn' : 'ok') : 'fail'}</Pill>
                <a href={c.url as string} target="_blank" rel="noopener noreferrer" className="hover:text-mk-accent-soft break-all">{c.url as string}</a>
                <span className="text-xs text-mk-muted">{c.status ?? '—'} · {c.ms}ms{c.problem ? ` · ${c.problem}` : ''}</span>
              </p>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <SectionTitle>Open issues ({open.length})</SectionTitle>
        {open.length === 0 ? <p className={tone.muted}>Nothing open.</p> : (
          <div className="space-y-2">
            {open.map(i => (
              <div key={i.id} className={`${tone.inset} px-4 py-3`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill color={SEV[i.severity as keyof typeof SEV]}>{i.severity}</Pill>
                  <p className="text-sm text-mk-text flex-1">{i.title}</p>
                  <span className="text-[11px] text-mk-muted">from {i.origin}</span>
                  <IssueStatus id={i.id} status={i.status} />
                </div>
                {i.evidence && <p className="text-xs text-mk-muted mt-1">{i.evidence}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
      {closed.length > 0 && <p className={tone.muted}>{closed.length} closed issue(s).</p>}
    </div>
  )
}
