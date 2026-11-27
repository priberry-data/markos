import { db } from '@/lib/db'
import { canReadFiles, generateObject, generateText, searchModelFor, unusableAi, type CallContext } from '@/lib/llm'
import { ProviderError, type Source } from '@/lib/llm/types'
import { startJob } from '@/lib/utils/jobs'
import { describeFailure } from '../orchestrator'
import { findPlaceholder, verifySources } from '../sources'
import { recordSources } from '../store'
import { TaskResultSchema, type ExecKey, type TaskResult } from '../schemas'
import { applyModelSettings, workContext } from './context'
import { execFacts } from './exec-facts'
import { repoDigestBlock } from './repo-digest'
import { analyse, renderAnalytics } from './analytics'
import { EXECS, systemFor } from './roster'
import { post } from './team-room'

// A task is one piece of work for one exec — from the founder (via the Chief
// of Staff) or handed over by another exec. Internal work runs on its own;
// anything that would reach a person (a post, an email, a pitch) lands as a
// draft for the founder's one-tap approval.

export interface TaskRow {
  id: string
  exec: ExecKey
  product_id: string | null
  task: string
  why: string | null
  origin: string
  night_id: string | null
}

export async function createTasks(rows: Array<{
  exec: ExecKey; productId: string | null; task: string; why?: string | null
  priority?: 'high' | 'normal' | 'low'; due?: string | null; origin?: string
  directiveId?: string | null; nightId?: string | null
}>): Promise<string[]> {
  if (rows.length === 0) return []
  const { data, error } = await db().from('tasks').insert(rows.map(r => ({
    exec: r.exec,
    product_id: r.productId,
    task: r.task,
    why: r.why ?? null,
    priority: r.priority ?? 'normal',
    due: r.due && /^\d{4}-\d{2}-\d{2}$/.test(r.due) ? r.due : null,
    origin: r.origin ?? 'founder',
    directive_id: r.directiveId ?? null,
    night_id: r.nightId ?? null,
  }))).select('id')
  if (error) throw new Error(`Could not save tasks: ${error.message}`)
  return (data ?? []).map(r => r.id as string)
}

/**
 * Work one exec hands another. Capped, de-duplicated against open tasks, and
 * never chained: a task that was itself a handoff can't hand off again, so
 * execs can't keep each other busy all night.
 */
export async function queueHandoffs(
  handoffs: Array<{ to: ExecKey; task: string; why: string }>,
  from: { from: ExecKey; productId: string | null; nightId: string | null },
): Promise<string[]> {
  if (handoffs.length === 0) return []
  const { data: open } = await db().from('tasks').select('exec, task, product_id').in('status', ['queued', 'running'])
  const key = (exec: string, product: string | null, task: string) => `${exec}|${product ?? ''}|${task.trim().toLowerCase()}`
  const existing = new Set((open ?? []).map(t => key(t.exec as string, t.product_id as string | null, t.task as string)))
  // Myra books meetings and nothing else: other work handed to her stays with the sender.
  const routed = handoffs.map(h => (h.to === 'ea' && !isMeetingRequest(h.task) ? { ...h, to: from.from } : h))
  const load = await openLoad()
  const fresh = routed.filter(h => h.to !== from.from && !existing.has(key(h.to, from.productId, h.task)))
    .filter(h => {
      // A teammate already at the limit doesn't get more; finish before starting.
      const n = load.get(h.to) ?? 0
      if (n >= WIP_LIMIT) return false
      load.set(h.to, n + 1)
      return true
    })
    .slice(0, 3)
  const ids = await createTasks(fresh.map(h => ({
    exec: h.to, productId: from.productId, task: h.task, why: h.why, origin: from.from, nightId: from.nightId,
  })))
  await Promise.all(fresh.map((h, i) => post({
    speaker: from.from, kind: 'handoff', to: [h.to], content: `${h.task} — ${h.why}`, productId: from.productId, taskId: ids[i],
  })))
  return ids
}

/**
 * Moves an exec decided to do itself ("doing_it"): they become its own tasks,
 * so advice turns into work the same night. Internal work only — anything a
 * move produces that would reach a person still lands as a draft for approval.
 * Capped, de-duplicated, and like handoffs they can't spawn further work.
 */
export async function queueOwnMoves(
  exec: ExecKey,
  moves: Array<{ mode: string; task: string | null; why_now: string }>,
  ctx: { productId: string | null; nightId: string | null },
): Promise<string[]> {
  const room = WIP_LIMIT - ((await openLoad()).get(exec) ?? 0)
  const doing = moves.filter(m => m.mode === 'doing_it' && m.task?.trim()).slice(0, Math.max(0, Math.min(2, room)))
  if (doing.length === 0) return []
  const { data: open } = await db().from('tasks').select('task, product_id').eq('exec', exec).in('status', ['queued', 'running'])
  const have = new Set((open ?? []).map(t => `${t.product_id ?? ''}|${String(t.task).trim().toLowerCase()}`))
  const fresh = doing.filter(m => !have.has(`${ctx.productId ?? ''}|${m.task!.trim().toLowerCase()}`))
  const ids = await createTasks(fresh.map(m => ({
    exec, productId: ctx.productId, task: m.task!, why: m.why_now, origin: exec, nightId: ctx.nightId,
  })))
  await Promise.all(fresh.map((m, i) => post({
    speaker: exec, kind: 'move', content: `I'm taking this on: ${m.task} (why now: ${m.why_now})`, productId: ctx.productId, taskId: ids[i],
  })))
  return ids
}

/** No exec carries more than this many open tasks it gave itself or got from a teammate. */
export const WIP_LIMIT = 3

/** Open tasks per exec right now (the founder's own instructions never count against this). */
async function openLoad(): Promise<Map<string, number>> {
  const { data } = await db().from('tasks').select('exec').in('status', ['queued', 'running']).neq('origin', 'founder')
  const load = new Map<string, number>()
  for (const t of data ?? []) load.set(t.exec as string, (load.get(t.exec as string) ?? 0) + 1)
  return load
}

/** Is this something Myra should act on — a meeting, call or time with the founder? */
export function isMeetingRequest(text: string): boolean {
  return /\b(meet|meeting|call|calendar|schedule|book (?:time|a)|set up time|sync|1:1|one[- ]on[- ]one|catch up|baithak|milna)\b/i.test(text)
}

/** Start a task in the background now (the app is open). */
export function dispatchTask(id: string) {
  startJob(`task:${id}`, signal => executeTask(id, signal))
}

export async function executeTask(id: string, signal?: AbortSignal): Promise<void> {
  const supabase = db()
  const { data: task } = await supabase.from('tasks').select('*').eq('id', id).single()
  if (!task || task.status !== 'queued') return
  await supabase.from('tasks').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', id)

  try {
    const result = await doTask(task as TaskRow, signal)
    const { error } = await supabase.from('tasks').update({
      status: 'done',
      result: result.result,
      result_summary: result.result.summary,
      sources: result.sources,
      finished_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) throw new Error(`Could not save the task result: ${error.message}`)
    await post({
      speaker: task.exec === 'founder' ? 'system' : task.exec, kind: 'done', taskId: id, productId: task.product_id,
      to: task.origin && task.origin !== 'founder' && task.origin !== task.exec && EXECS[task.origin as ExecKey] ? [task.origin] : [],
      content: `Done — ${task.task}\n${result.result.summary}`,
    })
  } catch (err) {
    const message = describeFailure(err).message
    // Stopped by the plan's usage limit: back in the queue, to run after the reset.
    const paused = err instanceof ProviderError && err.kind === 'usage_limit'
    await supabase.from('tasks').update({
      status: signal?.aborted ? 'cancelled' : paused ? 'queued' : 'failed',
      error_message: message,
      started_at: paused ? null : undefined,
      finished_at: paused ? null : new Date().toISOString(),
    }).eq('id', id)
    if (!paused && !signal?.aborted) {
      await post({ speaker: task.exec, kind: 'failed', taskId: id, productId: task.product_id, content: `Couldn’t finish “${task.task}”: ${message}` })
    }
    // Let the night shift see a usage-limit stop and pause, rather than burn through the queue.
    throw err
  }
}

async function doTask(task: TaskRow, signal?: AbortSignal): Promise<{ result: TaskResult; sources: Source[] }> {
  await applyModelSettings()
  // The Data team answers with real queries against the product's own database.
  if (task.exec === 'data' && task.product_id) {
    const { analyseWithData } = await import('./data-team')
    const a = await analyseWithData(task.product_id, task.task, signal)
    const deliverable = [
      a.answer,
      a.findings.length ? `\n${a.findings.map(f => `- ${f}`).join('\n')}` : '',
      a.data_quality.length ? `\nData quality:\n${a.data_quality.map(f => `- ${f}`).join('\n')}` : '',
      a.queries.length ? `\nQueries run (read-only):\n${a.queries.map(q => `- ${q.purpose}${q.error ? ` — failed: ${q.error}` : ''}`).join('\n')}` : '',
    ].join('\n').trim()
    return {
      result: { summary: a.answer, deliverable, findings: [], content_drafts: [], pipeline_adds: [], numbers_needed: [], handoffs: [], open_questions: a.caveats },
      sources: [],
    }
  }

  // The Executive Assistant's work is the calendar: a task for it is a meeting to book.
  if (task.exec === 'ea') {
    if (!isMeetingRequest(task.task)) {
      throw new Error('Myra only books meetings. This looks like other work — give it to the exec who owns it.')
    }
    const { addToUpcomingDecisionMeeting, bookFromRequest } = await import('./office')
    // Only the founder books extra meetings; a teammate's request joins the next decision meeting.
    if (task.origin !== 'founder') {
      const joined = await addToUpcomingDecisionMeeting(task.task, task.origin)
      if (joined) {
        const summary = `Added to “${joined.title}” on ${new Date(joined.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} instead of booking another meeting.`
        return { result: { summary, deliverable: summary, findings: [], content_drafts: [], pipeline_adds: [], numbers_needed: [], handoffs: [], open_questions: [] }, sources: [] }
      }
    }
    const booked = await bookFromRequest(task.task, signal)
    const summary = booked
      ? `Booked for ${booked.scheduledAt.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}. It's on your calendar.`
      : 'No free slot in your meeting windows over the next two weeks — widen them in Settings, or I can put it in the brief instead.'
    return {
      result: { summary, deliverable: summary, findings: [], content_drafts: [], pipeline_adds: [], numbers_needed: [], handoffs: [], open_questions: [] },
      sources: [],
    }
  }
  const profile = EXECS[task.exec]
  const ctx = await workContext(task.product_id)
  const readPaths = profile.repo ? (task.exec === 'platform' ? [process.cwd()] : ctx.readPaths) : []
  const call: CallContext = { agent: task.exec, productId: task.product_id, signal }

  // 1. Gather: search the web and/or read the repo, when the role allows.
  let notes = ''
  let evidence = ''
  let sources: Source[] = []
  // Web and files go in separate calls, never one: see buildArgs in claude-code.ts.
  const gather = async (web: boolean, paths: string[]) => {
    if (!web && !paths.length) return null
    return generateText(call, {
      system: systemFor(task.exec),
      prompt: `${ctx.text}

## YOUR TASK
${task.task}
${task.why ? `(Why: ${task.why})` : ''}

${web ? 'Search the web for what this task needs. ' : ''}${paths.length ? `You may read files under: ${paths.join(', ')}. ` : ''}Write detailed working notes: what you found, where (URL or file path), and what you could not find. Do not write the final deliverable yet.`,
      grounded: web,
      readPaths: paths,
      maxOutputTokens: 6000,
      purpose: 'task research',
    })
  }
  // Only search when some AI that's set up can really search; never let one guess.
  let web = profile.web && searchModelFor(task.exec) !== null
  // Why the search didn't run, when every AI that could do it turned out unusable (signed
  // out, no billing): the task goes on without the web and says so, instead of failing or
  // stopping the night. A plan's usage limit isn't this: it pauses the task until the reset.
  let searchFailed = ''
  const searched = web
    ? await gather(true, []).catch((err: unknown) => {
      if (!unusableAi(err)) throw err
      web = false
      searchFailed = err.message
      return null
    })
    : null
  // Claude Code opens the files itself; any other AI gets a digest MarkOS reads.
  const readFiles = canReadFiles(task.exec)
  for (const g of [searched, readFiles ? await gather(false, readPaths) : null]) {
    if (!g) continue
    notes = notes ? `${notes}\n\n${g.text}` : g.text
    evidence = evidence ? `${evidence}\n\n${g.evidence}` : g.evidence
    sources = [...sources, ...g.sources.filter(s => !sources.some(k => k.url === s.url))]
  }
  // Kept apart from the notes: the notes are the agent's own work; these are not.
  const codeBlock = !readFiles && readPaths.length ? await repoDigestBlock(readPaths) : ''
  const noSearch = profile.web && !web

  // The same facts and analytics a report gets, counted by code.
  const since = new Date(Date.now() - 14 * 86400_000)
  const [facts, analytics] = await Promise.all([
    execFacts(task.exec, task.product_id, since, readPaths),
    analyse(task.product_id),
  ])
  const factsBlock = `## ANALYTICS (counted by code)\n${renderAnalytics(analytics)}\n\n## FACTS (gathered by code — the only numbers you may state)\n${facts}`

  // 2. Deliver in the fixed shape.
  const known = [...sources, ...ctx.known]
  const sourceList = sources.length ? sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n') : '(none)'
  const { data } = await generateObject(call, {
    system: systemFor(task.exec),
    prompt: `${ctx.text}

${factsBlock}

## YOUR TASK
${task.task}
${task.why ? `(Why: ${task.why})` : ''}

${notes ? `## YOUR WORKING NOTES — your own research for this task, done a moment ago (you searched the web${readFiles ? ' and/or read the files' : ''} yourself)\n${notes}\n\n## SOURCES (cite only these URLs, copied exactly)\n${sourceList}` : codeBlock || noSearch ? '' : 'You have no web or repo access for this task: work from the context above and say what you would need.'}
${codeBlock ? `\n${codeBlock}\n` : ''}${noSearch ? `\nNO WEB SEARCH: ${searchFailed ? `the web search couldn’t run (${searchFailed})` : 'the AI this team runs on can’t search the web, and no AI that can is set up'}. Nothing here comes from the web: don’t state web facts or give URLs; list what needs checking in open_questions.\n` : ''}
Deliver the result, writing as yourself${notes ? ': the notes are your own work, so never say you lack a tool or that "someone else" did the research' : ''}. If something genuinely needs access nobody on the team has (running code, production data, third-party dashboards), say so once and put it in open_questions for the founder.
content_drafts only if the task asks for posts or emails; pipeline_adds only for sales, partner or recruiting work.${task.origin !== 'founder' ? '\nThis task was handed to you by another exec: do not hand it on again (handoffs must be empty).' : ''}`,
    schema: TaskResultSchema,
    purpose: 'task',
    tier: notes ? 'shape' : 'main',
  })

  // 3. Code decides what's real.
  const verified = verifySources(data, known).data
  const result: TaskResult = {
    ...verified,
    content_drafts: verified.content_drafts.filter(d => !findPlaceholder(d.body) && !findPlaceholder(d.title)),
    pipeline_adds: verified.pipeline_adds.map(p => ({
      ...p,
      contact: p.contact && evidence.toLowerCase().includes(p.contact.toLowerCase().trim()) ? p.contact : null,
      pitch_body: p.pitch_body && findPlaceholder(p.pitch_body) ? null : p.pitch_body,
    })),
    handoffs: task.origin === 'founder' ? verified.handoffs.slice(0, 3) : [],
    // Nothing silent: a search that was meant to run and couldn't is said where the founder reads
    // (the task, the team room and the morning brief all show the summary), and kept on the record.
    summary: searchFailed ? `${verified.summary} (Done without a web search, which couldn’t run: ${searchFailed})` : verified.summary,
    open_questions: searchFailed
      ? [...verified.open_questions, `Done without a web search, which couldn’t run: ${searchFailed}`]
      : verified.open_questions,
  }
  await persist(task, result, sources)
  return { result, sources }
}

async function persist(task: TaskRow, result: TaskResult, sources: Source[]) {
  const supabase = db()
  if (task.product_id) {
    await recordSources(task.product_id, task.exec, null, sources)
    if (result.content_drafts.length) {
      const { error } = await supabase.from('content_items').insert(result.content_drafts.map(d => ({
        product_id: task.product_id,
        platform: d.platform,
        content_type: 'post',
        title: d.title,
        body: d.body,
        goal: `For: ${task.task}`.slice(0, 300),
        status: 'draft',
      })))
      if (error) throw new Error(`Could not save drafts: ${error.message}`)
    }
    if (result.pipeline_adds.length) {
      const { error } = await supabase.from('pipeline').upsert(result.pipeline_adds.map(p => ({
        product_id: task.product_id,
        kind: p.kind,
        name: p.name,
        website: p.website,
        why_fit: p.why_fit,
        source: p.source,
        verified: Boolean(p.source),
        contact: p.contact,
        pitch_subject: p.pitch_subject,
        pitch_body: p.pitch_body,
      })), { onConflict: 'product_id,name', ignoreDuplicates: true })
      if (error) throw new Error(`Could not save the pipeline: ${error.message}`)
    }
  }
  await queueHandoffs(result.handoffs, { from: task.exec, productId: task.product_id, nightId: task.night_id })
}
