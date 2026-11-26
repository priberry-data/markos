import { Cite, Pill, tone } from '@/components/engine/ui'
import { Collapsible } from './brief-client'
import type { ExecReport } from '@/lib/engine/schemas'

// One exec report, readable at a glance: the headline, then (opened) what the
// numbers say, the moves, what was done, decisions, risks and metrics.

export function ReportCard({ product, report, at, open = false }: { product: string; report: ExecReport; at: string; open?: boolean }) {
  const when = new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <div className={`${tone.inset} px-4 py-3`}>
      <Collapsible defaultOpen={open}
        title={<span className="text-sm"><span className="text-mk-accent-soft">{product}</span> <span className="text-mk-body">— {report.headline}</span></span>}
        right={<span className="text-[10px] text-mk-muted whitespace-nowrap">{when}</span>}>
        <div className="space-y-3 text-sm">
          {(report.insights ?? []).length > 0 && (
            <div>
              <p className={tone.label}>What the numbers say</p>
              {report.insights.map((x, i) => <p key={i} className="mt-1 text-mk-body">• {x.finding} <span className="text-xs text-mk-muted">({x.evidence})</span></p>)}
            </div>
          )}
          {(report.moves ?? []).length > 0 && (
            <div>
              <p className={tone.label}>Moves</p>
              {report.moves.map((m, i) => (
                <div key={i} className="mt-1.5">
                  <p className="text-mk-text">
                    <Pill color={m.mode === 'doing_it' ? 'green' : m.mode === 'needs_your_ok' ? 'amber' : 'violet'}>
                      {m.mode === 'doing_it' ? 'doing it' : m.mode === 'needs_your_ok' ? 'needs your OK' : 'needs your input'}
                    </Pill> {m.move}
                  </p>
                  <p className="text-xs text-mk-muted">Why now: {m.why_now} · Expect: {m.expected_impact}</p>
                </div>
              ))}
            </div>
          )}
          {report.done.length > 0 && <List label="Done" items={report.done.map(d => d.what)} />}
          {report.decisions_needed.length > 0 && (
            <div>
              <p className={tone.label}>Needs your decision</p>
              {report.decisions_needed.map((d, i) => (
                <div key={i} className="mt-1.5">
                  <p className="text-mk-text">{d.question}</p>
                  <p className="text-xs text-mk-muted">Recommends <span className="text-mk-body">{d.recommendation}</span> — {d.why}</p>
                </div>
              ))}
            </div>
          )}
          {report.risks.length > 0 && (
            <div>
              <p className={tone.label}>Risks</p>
              {report.risks.map((r, i) => (
                <p key={i} className="mt-1 text-mk-body">
                  <Pill color={r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'amber' : 'default'}>{r.severity}</Pill> {r.risk}
                  {r.source?.startsWith('http') ? <Cite url={r.source} /> : r.source ? <span className="text-[11px] text-mk-muted ml-2">{r.source}</span> : null}
                </p>
              ))}
            </div>
          )}
          {report.metrics.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.metrics.map((m, i) => (
                <div key={i} className="bg-mk-card border border-mk-line rounded-lg px-3 py-1.5">
                  <p className="text-[10px] text-mk-muted uppercase">{m.name}</p>
                  <p className={m.value === null ? 'text-xs text-mk-warn' : 'text-sm text-mk-text'} title={m.basis ?? undefined}>{m.value ?? 'unknown — enter it'}</p>
                </div>
              ))}
            </div>
          )}
          {report.numbers_needed.length > 0 && <List label="Numbers only you have" items={report.numbers_needed} />}
        </div>
      </Collapsible>
    </div>
  )
}

function List({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className={tone.label}>{label}</p>
      <ul className="mt-1 space-y-0.5">{items.map((x, i) => <li key={i} className="text-mk-body">• {x}</li>)}</ul>
    </div>
  )
}
