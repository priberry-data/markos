import { db } from '@/lib/db'
import { canReadFiles, generateObject, type CallContext } from '@/lib/llm'
import { ExecReportSchema, type ExecKey, type ExecReport } from '../schemas'
import { applyModelSettings, citationOk, lastReport, recentWork, workContext } from './context'
import { execFacts } from './exec-facts'
import { repoDigestBlock } from './repo-digest'
import { EXECS, systemFor } from './roster'
import { queueHandoffs, queueOwnMoves } from './tasks'
import { post } from './team-room'
import { analyse, renderAnalytics } from './analytics'

// One exec writes its report: per product, or once for the portfolio.
//
// The model gets FACTS gathered by code, may read the repo when its role
// allows, and must return the fixed report shape. Afterwards code — not the
// model — removes any number without a basis and any citation that isn't a
// real retrieved page or a file the exec could read.

const DAY = 86400_000
export async function writeReport(args: {
  exec: ExecKey
  productId: string | null
  nightId: string | null
  signal?: AbortSignal
  budgetUsd?: number
  runId?: string | null
}): Promise<{ id: string; report: ExecReport }> {
  const { exec, productId, nightId } = args
  await applyModelSettings()
  const previous = await lastReport(exec, productId)
  const since = previous?.at ?? new Date(Date.now() - 7 * DAY)
  const ctx = await workContext(productId)
  const readPaths = EXECS[exec].repo ? (exec === 'platform' ? [process.cwd()] : ctx.readPaths) : []
  // Claude Code opens the files itself; any other AI gets a digest MarkOS reads.
  const readFiles = canReadFiles(exec)
  const [facts, work, analytics, digest] = await Promise.all([
    execFacts(exec, productId, since, readPaths), recentWork(exec, productId, since), analyse(productId),
    readFiles ? '' : repoDigestBlock(readPaths),
  ])

  const call: CallContext = { agent: exec, productId, signal: args.signal, runId: args.runId ?? null, budgetUsd: args.budgetUsd }
  const { data } = await generateObject(call, {
    system: systemFor(exec),
    prompt: `Write today's report${productId ? '' : ' for the whole portfolio'}.

${ctx.text}

## ANALYTICS (counted by code — run your daily routine on this)
${renderAnalytics(analytics)}

## FACTS (gathered by code just now — the only numbers you may state)
Reporting period: since ${since.toISOString().slice(0, 16).replace('T', ' ')}
${facts}

## YOUR WORK SINCE THE LAST REPORT
${work}

## YOUR LAST HEADLINE
${previous?.headline || '(this is your first report)'}
${readPaths.length ? (readFiles ? `\nYou may read files under: ${readPaths.join(', ')}. Read only what you need.` : `\n${digest}`) : ''}
Run your skill's daily routine. Analyse first (insights, each with its evidence), then decide: what should the company do next in your area? Use your decision rules and pick from your plays where they fit the evidence.
Moves you can do yourself right now (research, drafts, analysis, plans) are mode "doing_it" with the exact task — the team will do them tonight. Anything public, costly or hard to undo is "needs_your_ok". Don't wait to be asked.
If nothing happened, say that in one line rather than padding.`,
    schema: ExecReportSchema,
    purpose: 'report',
    readPaths: readFiles ? readPaths : [],
  })

  const report = sanitizeReport(data, ctx.known, readPaths)
  const { data: row, error } = await db().from('exec_reports')
    .insert({ night_id: nightId, exec, product_id: productId, report })
    .select('id').single()
  if (error) throw new Error(`Could not save the ${EXECS[exec].title} report: ${error.message}`)
  await post({ speaker: exec, kind: 'report', productId, content: report.headline })
  await queueHandoffs(report.handoffs, { from: exec, productId, nightId })
  await queueOwnMoves(exec, report.moves, { productId, nightId })
  if (productId && report.issues.length) {
    const { error: issueError } = await db().from('issues').upsert(report.issues.map(i => ({
      product_id: productId, title: i.title, severity: i.severity, evidence: i.evidence, area: i.area,
      origin: exec, status: 'open', updated_at: new Date().toISOString(),
    })), { onConflict: 'product_id,title' })
    if (issueError) throw new Error(`Could not save issues: ${issueError.message}`)
  }
  return { id: row.id as string, report }
}

/** Numbers need a basis; citations must be real. Enforced here, not trusted to the model. */
export function sanitizeReport(report: ExecReport, known: Parameters<typeof citationOk>[1], readPaths: string[]): ExecReport {
  return {
    ...report,
    metrics: report.metrics.map(m => (m.value !== null && !m.basis ? { ...m, value: null } : m)),
    risks: report.risks.map(r => (r.source && !citationOk(r.source, known, readPaths) ? { ...r, source: null } : r)),
    decisions_needed: report.decisions_needed.slice(0, 5),
    handoffs: report.handoffs.slice(0, 3),
    insights: report.insights.slice(0, 4),
    issues: (report.issues ?? []).slice(0, 10),
    // "doing_it" without a task can't be done: it becomes a request for input.
    moves: report.moves.slice(0, 3).map(m => (m.mode === 'doing_it' && !m.task?.trim() ? { ...m, mode: 'needs_your_input' as const } : m)),
  }
}
