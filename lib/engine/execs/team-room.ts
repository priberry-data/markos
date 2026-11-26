import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { startJob } from '@/lib/utils/jobs'
import { describeFailure } from '../orchestrator'
import { AgentReplySchema, EXEC_KEYS, RoomRespondersSchema, TeammateAnswerSchema, type ExecKey } from '../schemas'
import { applyModelSettings, portfolio, renderPortfolio, workContext } from './context'
import { EXECS, systemFor } from './roster'
import { CHARTER } from '../charter'

// The team room: one group conversation between the founder and every agent.
//
// Agents are individuals here. When the founder writes, the Chief of Staff
// picks who should answer (or the founder @mentions them), and each one
// replies separately — from its own instructions, skill, latest report and
// open work — and can act: take on a task, hand one to a teammate, ask a
// teammate a question (who answers in the room), or have Myra book a meeting.
//
// Everything else in the room is a real event: hand-offs, moves, tasks
// started and finished, reports, bookings, bugs. Conversations are bounded —
// at most three agents answer the founder, and a teammate's answer never
// asks again — so the room can't run away with itself.

export type Speaker = 'founder' | 'chief_of_staff' | 'system' | ExecKey

export async function post(msg: {
  speaker: Speaker
  content: string
  kind?: string
  to?: string[]
  productId?: string | null
  taskId?: string | null
  meetingId?: string | null
  replyTo?: string | null
}): Promise<string | null> {
  const { data, error } = await db().from('team_messages').insert({
    speaker: msg.speaker,
    content: msg.content.slice(0, 6000),
    kind: msg.kind ?? 'chat',
    to_seats: msg.to ?? [],
    product_id: msg.productId ?? null,
    task_id: msg.taskId ?? null,
    meeting_id: msg.meetingId ?? null,
    reply_to: msg.replyTo ?? null,
  }).select('id').single()
  // The room is a window on the work, not the work itself: a failed post is logged, never fatal.
  if (error) { console.error('[team room] could not post:', error.message); return null }
  return data.id as string
}

const label = (s: string) => (s === 'founder' ? 'Founder' : s === 'chief_of_staff' ? 'Chief of Staff' : EXECS[s as ExecKey]?.title ?? s)

async function history(limit = 30): Promise<string> {
  const { data } = await db().from('team_messages').select('speaker, to_seats, kind, content, created_at')
    .order('created_at', { ascending: false }).limit(limit)
  return (data ?? []).reverse().map(m =>
    `${label(m.speaker as string)}${(m.to_seats as string[]).length ? ` → ${(m.to_seats as string[]).map(label).join(', ')}` : ''}${m.kind !== 'chat' ? ` [${m.kind}]` : ''}: ${m.content}`,
  ).join('\n') || '(the room is quiet)'
}

async function myDesk(exec: ExecKey): Promise<string> {
  const supabase = db()
  const [{ data: report }, { data: tasks }] = await Promise.all([
    supabase.from('exec_reports').select('report, product_id').eq('exec', exec).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('tasks').select('task, status, result_summary').eq('exec', exec).in('status', ['queued', 'running', 'done'])
      .order('created_at', { ascending: false }).limit(8),
  ])
  return [
    `Your latest report: ${report ? JSON.stringify(report.report).slice(0, 3000) : '(none yet)'}`,
    `Your recent and open tasks:\n${(tasks ?? []).map(t => `- [${t.status}] ${t.task}${t.result_summary ? ` → ${t.result_summary}` : ''}`).join('\n') || '- none'}`,
  ].join('\n\n')
}

const MENTION: Record<string, ExecKey> = {
  cmo: 'cmo', cfo: 'cfo', cpo: 'cpo', cto: 'cto', sales: 'sales', coo: 'coo', qa: 'qa', customer: 'cx', cx: 'cx', myra: 'ea', ea: 'ea', data: 'data', platform: 'platform',
}

export function mentions(text: string): ExecKey[] {
  const found = [...text.toLowerCase().matchAll(/@([a-z]+)/g)].map(m => MENTION[m[1]]).filter(Boolean)
  return [...new Set(found)]
}

/** The founder writes in the room. Replies arrive in the background. */
export async function founderSays(text: string): Promise<string> {
  const clean = text.trim().slice(0, 4000)
  if (!clean) throw new Error('Say something first')
  const id = await post({ speaker: 'founder', content: clean, to: mentions(clean) })
  if (!id) throw new Error('Could not post your message')
  startJob(`room:${id}`, signal => respond(id, clean, signal))
  return id
}

async function respond(messageId: string, text: string, signal: AbortSignal) {
  try {
    await applyModelSettings()
    const [products, room] = await Promise.all([portfolio(), history()])
    let responders = mentions(text)
    if (responders.length === 0) {
      const { data } = await generateObject({ agent: 'chief_of_staff', signal }, {
        system: `${CHARTER}\n\nYou are the Chief of Staff deciding who on the team should answer the founder in the group chat.\nTHE TEAM:\n${EXEC_KEYS.map(k => `- ${k} (${EXECS[k].title}): ${EXECS[k].owns}`).join('\n')}`,
        prompt: `PRODUCTS:\n${renderPortfolio(products)}\n\nTHE ROOM SO FAR:\n${room}\n\nTHE FOUNDER JUST SAID:\n"""${text}"""\n\nWho should answer? Usually one; two or three only if each owns a real part of it.`,
        schema: RoomRespondersSchema,
        purpose: 'room routing',
        tier: 'shape',
        maxOutputTokens: 300,
      })
      responders = data.responders
    }
    responders = [...new Set(responders)].slice(0, 3)
    if (responders.length === 0) responders = ['coo']

    // Each agent answers as itself, in parallel.
    await Promise.all(responders.map(exec => agentReplies(exec, text, messageId, products, room, signal)))
  } catch (err) {
    await post({ speaker: 'system', kind: 'failed', content: `The team couldn’t answer: ${describeFailure(err).message}`, replyTo: messageId })
  }
}

async function agentReplies(
  exec: ExecKey, text: string, replyTo: string,
  products: Awaited<ReturnType<typeof portfolio>>, room: string, signal: AbortSignal,
) {
  const [desk, ctx] = await Promise.all([myDesk(exec), workContext(null)])
  const { data: reply } = await generateObject({ agent: exec, signal }, {
    system: `${systemFor(exec)}\n\nYOU ARE IN THE TEAM'S GROUP CHAT with the founder and your colleagues (${EXEC_KEYS.filter(k => k !== exec).map(k => EXECS[k].title).join(', ')}). Speak as yourself. You can act: take on a task, give one to a teammate, ask a teammate, or ask Myra (ea) to book a meeting with the founder. Only act when it moves things forward. Public actions still need the founder's approval.`,
    prompt: `${ctx.text}\n\n## YOUR DESK\n${desk}\n\n## THE ROOM SO FAR\n${room}\n\n## THE FOUNDER JUST SAID\n"""${text}"""\n\nReply in the room, and say what you'll do.`,
    schema: AgentReplySchema,
    purpose: 'room',
  })
  const msgId = await post({ speaker: exec, content: reply.text, replyTo })
  await carryOut(exec, reply.actions, products, msgId, signal)
}

/** What an agent said it would do, done. Internal work starts now; nothing public goes out. */
async function carryOut(
  exec: ExecKey,
  actions: Array<{ type: 'task' | 'ask' | 'meeting'; to: ExecKey | null; product: string | null; content: string; due: string | null }>,
  products: Awaited<ReturnType<typeof portfolio>>,
  replyTo: string | null,
  signal: AbortSignal,
  allowAsk = true,
) {
  const { createTasks, dispatchTask } = await import('./tasks')
  const productId = (name: string | null) => (name ? products.find(p => p.name.toLowerCase() === name.toLowerCase())?.id ?? null : null)
  for (const a of actions.slice(0, 3)) {
    if (a.type === 'task') {
      const { isMeetingRequest } = await import('./tasks')
      const owner = a.to && EXECS[a.to] && !(a.to === 'ea' && !isMeetingRequest(a.content)) ? a.to : exec
      const [id] = await createTasks([{ exec: owner, productId: productId(a.product), task: a.content, due: a.due, origin: 'founder', why: 'Agreed in the team room' }])
      if (owner !== exec) await post({ speaker: exec, kind: 'handoff', to: [owner], content: a.content, taskId: id, productId: productId(a.product), replyTo })
      dispatchTask(id)
    } else if (a.type === 'meeting') {
      const [id] = await createTasks([{ exec: 'ea', productId: productId(a.product), task: `${a.content} (with ${EXECS[exec].title})`, origin: 'founder', why: `Asked for by ${EXECS[exec].title} in the team room` }])
      await post({ speaker: exec, kind: 'handoff', to: ['ea'], content: `Please book time with the founder: ${a.content}`, taskId: id, replyTo })
      dispatchTask(id)
    } else if (a.type === 'ask' && allowAsk && a.to && a.to !== exec && EXECS[a.to]) {
      const qId = await post({ speaker: exec, kind: 'question', to: [a.to], content: a.content, productId: productId(a.product), replyTo })
      await teammateAnswers(a.to, exec, a.content, qId, products, signal)
    }
  }
}

/** One agent asked another; the other answers in the room — once, never asking back. */
async function teammateAnswers(
  exec: ExecKey, asker: ExecKey, question: string, replyTo: string | null,
  products: Awaited<ReturnType<typeof portfolio>>, signal: AbortSignal,
) {
  const [desk, room] = await Promise.all([myDesk(exec), history(20)])
  const { data } = await generateObject({ agent: exec, signal }, {
    system: `${systemFor(exec)}\n\nA colleague asked you something in the team's group chat. Answer them directly.`,
    prompt: `## YOUR DESK\n${desk}\n\n## THE ROOM\n${room}\n\n## ${EXECS[asker].title.toUpperCase()} ASKED YOU\n"""${question}"""`,
    schema: TeammateAnswerSchema,
    purpose: 'room answer',
  })
  const msgId = await post({ speaker: exec, kind: 'answer', to: [asker], content: data.text, replyTo })
  if (data.task) await carryOut(exec, [{ type: 'task', to: exec, product: null, content: data.task, due: null }], products, msgId, signal, false)
}
