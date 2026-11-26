import { db } from '@/lib/db'
import { CHARTER } from '../charter'
import { generateObject } from '@/lib/llm'
import { startJob } from '@/lib/utils/jobs'
import { describeFailure } from '../orchestrator'
import { pendingCounts } from '../status'
import { DirectiveSchema, MorningBriefSchema, RoutePreviewSchema, EXEC_KEYS, type Directive, type ExecKey, type MorningBrief } from '../schemas'
import { applyModelSettings, portfolio, renderPortfolio } from './context'
import { analyse, renderAnalytics } from './analytics'
import { CHIEF_OF_STAFF_RULES, EXECS } from './roster'
import { skillsPrompt } from './skills'
import { createTasks, dispatchTask } from './tasks'
import { post } from './team-room'

// The Chief of Staff reads every instruction the founder writes — in any
// language, Hinglish included — splits it into pieces of work, and sends each
// to the exec who owns it. Internal work starts straight away; the routing is
// shown so the founder can see (and change) who got what.

const ROUTER = `${CHARTER}

You are the founder's Chief of Staff. You route instructions to the executive team.

THE TEAM AND WHAT EACH OWNS:
${EXEC_KEYS.map(k => `- ${k} (${EXECS[k].title}): ${EXECS[k].owns}`).join('\n')}

HOW TO ROUTE:
- Read for meaning, not keywords. "Paisa kahan ja raha hai" is finance; "nobody knows about SCOUT" is marketing; "get ten companies to try it" is sales.
- Split an instruction into one task per exec who has real work in it. One exec, one task per product — combine related asks.
- A task names exactly one product from PRODUCTS, or none for portfolio-wide work. If the founder names a sub-product (SCOUT, VERA, the labs), use the product it belongs to and keep the name in the task.
- Write each task so the exec can act on it alone, with the founder's specifics kept (numbers, names, dates).
- Ask a clarifying question ONLY when no sensible reading exists. A vague instruction still gets a sensible first task.
${CHIEF_OF_STAFF_RULES}`

export async function submitDirective(text: string, targetExec?: ExecKey | null): Promise<string> {
  const clean = text.trim().slice(0, 4000)
  if (!clean) throw new Error('Write an instruction first')
  const { data, error } = await db().from('directives')
    .insert({ text: clean, target_exec: targetExec ?? null, status: 'routing' }).select('id').single()
  if (error) throw new Error(`Could not save the instruction: ${error.message}`)
  const id = data.id as string
  startJob(`directive:${id}`, signal => routeDirective(id, signal))
  return id
}

export async function routeDirective(id: string, signal?: AbortSignal): Promise<Directive | null> {
  const supabase = db()
  const { data: d } = await supabase.from('directives').select('*').eq('id', id).single()
  if (!d) return null
  await applyModelSettings()
  const products = await portfolio()
  try {
    const { data: directive } = await generateObject({ agent: 'chief_of_staff', signal }, {
      system: ROUTER,
      prompt: `PRODUCTS:\n${renderPortfolio(products)}

${d.target_exec ? `The founder wrote this directly to ${EXECS[d.target_exec as ExecKey].title}: route it to ${d.target_exec} unless part of it clearly belongs to someone else.\n` : ''}INSTRUCTION FROM THE FOUNDER (today is ${new Date().toISOString().slice(0, 10)}):
"""${d.text}"""`,
      schema: DirectiveSchema,
      purpose: 'route',
    })

    const byName = new Map(products.map(p => [p.name.toLowerCase(), p.id]))
    const rows = directive.tasks.map(t => ({
      exec: t.exec,
      productId: t.product ? byName.get(t.product.toLowerCase()) ?? null : null,
      task: t.product && !byName.has(t.product.toLowerCase()) ? `${t.task} (about: ${t.product})` : t.task,
      why: t.why,
      priority: t.priority,
      due: t.due,
      directiveId: id,
    }))
    const taskIds = directive.clarify && rows.length === 0 ? [] : await createTasks(rows)
    await supabase.from('directives').update({
      routing: directive,
      clarify: directive.clarify,
      status: rows.length === 0 && directive.clarify ? 'needs_clarity' : 'routed',
    }).eq('id', id)
    await post({
      speaker: 'chief_of_staff', kind: 'routing', to: [...new Set(rows.map(r => r.exec))],
      content: rows.length
        ? `${directive.understanding}\n${rows.map(r => `→ ${EXECS[r.exec].title}${r.productId ? ` (${products.find(p => p.id === r.productId)?.name})` : ''}: ${r.task}`).join('\n')}`
        : `I need one thing first: ${directive.clarify}`,
    })
    taskIds.forEach(dispatchTask)
    return directive
  } catch (err) {
    await supabase.from('directives').update({ status: 'failed', error_message: describeFailure(err).message }).eq('id', id)
    throw err
  }
}

/** Move a task to another exec (the founder dragged the chip). Re-runs it if it hadn't finished. */
export async function rerouteTask(taskId: string, exec: ExecKey) {
  const { data: task } = await db().from('tasks').select('status').eq('id', taskId).single()
  if (!task) throw new Error('Task not found')
  const { error } = await db().from('tasks').update({
    exec, status: 'queued', result: null, result_summary: null, error_message: null, started_at: null, finished_at: null,
  }).eq('id', taskId)
  if (error) throw new Error(error.message)
  dispatchTask(taskId)
}

// ── the morning brief ───────────────────────────────────────────────────────

export async function writeBrief(nightId: string, signal?: AbortSignal): Promise<MorningBrief> {
  const supabase = db()
  await applyModelSettings()
  const products = await portfolio()
  const name = new Map(products.map(p => [p.id, p.name]))
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999)
  const [{ data: meetings }, { data: founderTodos }] = await Promise.all([
    supabase.from('meetings').select('title, scheduled_at, duration_min').eq('status', 'scheduled')
      .gte('scheduled_at', new Date().toISOString()).lte('scheduled_at', new Date(dayEnd.getTime() + 86400_000).toISOString()).order('scheduled_at'),
    supabase.from('tasks').select('task, due').eq('exec', 'founder').eq('status', 'queued').order('due'),
  ])
  const { renderGoals } = await import('./goals')
  const goalsText = await renderGoals(null)
  const { data: intakes } = await supabase.from('products').select('name, intake').eq('status', 'active')
  const conflictText = (intakes ?? []).flatMap(p => ((p.intake as { conflicts?: Array<{ topic: string; values: string[] }> } | null)?.conflicts ?? [])
    .map(c => `- ${p.name} · ${c.topic}: ${c.values.join(' VS ')}`)).join('\n')
  const [{ data: reports }, { data: night }, { data: tasks }] = await Promise.all([
    supabase.from('exec_reports').select('exec, product_id, report').eq('night_id', nightId),
    supabase.from('nights').select('log, paused_reason, started_at').eq('id', nightId).single(),
    supabase.from('tasks').select('exec, product_id, task, status, result_summary, error_message')
      .gte('created_at', new Date(Date.now() - 36 * 3600_000).toISOString()),
  ])
  const waiting = await Promise.all(products.map(async p => `- ${p.name}: ${JSON.stringify(await pendingCounts(p.id))}`))
  // The scoreboard: the whole portfolio, then each product, counted by code.
  const [whole, ...each] = await Promise.all([analyse(null), ...products.map(p => analyse(p.id))])
  const scoreboard = [`### Portfolio\n${renderAnalytics(whole)}`, ...products.map((p, i) => `### ${p.name}\n${renderAnalytics(each[i])}`)].join('\n\n')

  const reportText = (reports ?? []).map(r =>
    `### ${EXECS[r.exec as ExecKey]?.title ?? r.exec} · ${r.product_id ? name.get(r.product_id) : 'portfolio'}\n${JSON.stringify(r.report)}`,
  ).join('\n\n')

  const { data: brief } = await generateObject({ agent: 'chief_of_staff', signal }, {
    system: `${CHARTER}\n\nYou are the founder's Chief of Staff writing the morning brief. It is the first thing they read.
${skillsPrompt('chief_of_staff')}

- Lead with what needs them: decisions, approvals, numbers only they have.
- Pick THE ONE THING for the portfolio today, from the evidence.
- Pick the three decisions that matter most across all products. Fewer is fine.
- Gather the execs' moves into the company's next moves: deduplicated, conflicts resolved, most important first.
- Be concrete: product names, counts, what exactly is waiting. No filler, no praise.
- If the night was cut short or something failed, say so first.
${CHIEF_OF_STAFF_RULES}`,
    prompt: `PRODUCTS:\n${renderPortfolio(products)}

NIGHT LOG:\n${JSON.stringify(night?.log ?? [])}
${night?.paused_reason ? `THE NIGHT WAS CUT SHORT: ${night.paused_reason}` : ''}

ANALYTICS (counted by code):\n${scoreboard}

WAITING FOR THE FOUNDER'S APPROVAL (counts):\n${waiting.join('\n')}

MEETINGS MYRA (THE EA) BOOKED (today and tomorrow):\n${(meetings ?? []).map(m => `- ${new Date(m.scheduled_at as string).toLocaleString()} (${m.duration_min} min): ${m.title}`).join('\n') || '- none'}

CONTRADICTIONS IN THE PRODUCTS' OWN FILES (only the founder can settle these — raise the important ones as decisions):\n${conflictText || '- none'}

${goalsText || 'THE COMPANY HAS NO GOALS YET — say so, and point the founder to confirm the drafted ones.'}
(Measure the night against these goals: what moved each one, what didn't.)

THE FOUNDER'S OWN TO-DOS:\n${(founderTodos ?? []).map(t => `- ${t.task}${t.due ? ` (due ${t.due}${String(t.due) < new Date().toISOString().slice(0, 10) ? ', OVERDUE' : ''})` : ''}`).join('\n') || '- none'}

TASKS IN THE LAST DAY:\n${(tasks ?? []).map(t => `- ${t.exec} · ${t.product_id ? name.get(t.product_id) : 'portfolio'} · ${t.status}: ${t.task}${t.result_summary ? ` → ${t.result_summary}` : ''}${t.error_message ? ` (${t.error_message})` : ''}`).join('\n') || '- none'}

EXEC REPORTS:\n${reportText || '(none were written)'}`,
    schema: MorningBriefSchema,
    purpose: 'brief',
  })

  await post({ speaker: 'chief_of_staff', kind: 'report', content: `Morning brief is ready: ${brief.headline}` })
  const { error } = await supabase.from('nights').update({ brief, analytics: { portfolio: whole, products: products.map((p, i) => ({ name: p.name, ...each[i] })) } }).eq('id', nightId)
  if (error) throw new Error(`Could not save the brief: ${error.message}`)
  return brief
}

/**
 * A quick semantic read of an instruction while the founder is still typing
 * or speaking — who would pick it up and why. Nothing is created; the real
 * routing happens on Send. Runs on the cheap reshaping model.
 */
export async function previewDirective(text: string, signal?: AbortSignal) {
  const clean = text.trim().slice(0, 2000)
  if (clean.length < 8) return { seats: [], products: [] }
  await applyModelSettings()
  const products = await portfolio()
  const { data } = await generateObject({ agent: 'chief_of_staff', signal }, {
    system: ROUTER,
    prompt: `PRODUCTS:\n${renderPortfolio(products)}\n\nThe founder is still writing this instruction. Who on the team would pick it up?\n"""${clean}"""`,
    schema: RoutePreviewSchema,
    purpose: 'route preview',
    tier: 'shape',
    maxOutputTokens: 800,
  })
  const names = new Map(products.map(p => [p.name.toLowerCase(), p]))
  return {
    seats: data.seats,
    products: data.products.map(n => names.get(n.toLowerCase())).filter(Boolean).map(p => ({ id: p!.id, name: p!.name })),
  }
}
