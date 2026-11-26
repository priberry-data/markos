import { z } from 'zod'
import { CHARTER } from './charter'
import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { AGENTS, type AgentKey } from '@/lib/llm/models'
import { loadBrain, renderBrief } from './brain'
import { pendingCounts } from './status'
import { addHouseRule, refineItem } from './items'
import { reviseStrategy, startAgentRun, PRODUCTION_AGENTS } from './orchestrator'

// LYRA — the one assistant. She sees the whole Product Brain and recent work,
// answers questions, and can propose actions. Actions that spend money or
// change work are proposed, then run only when the founder clicks — so a
// casual question can never trigger a full run by accident.
//
// Replaces three overlapping assistants in the old build: LYRA (which was
// never given product ids, so her "Execute" buttons never worked), ZEUS (a
// generalist that saw only the product name) and a context-aware chat route
// that nothing called.

const RUNNABLE = PRODUCTION_AGENTS

export const ActionSchema = z.object({
  type: z.enum(['none', 'run_agent', 'refine_content', 'add_rule', 'revise_strategy']),
  agent: z.enum(RUNNABLE as [AgentKey, ...AgentKey[]]).nullable().describe('For run_agent'),
  item_id: z.string().nullable().describe('For refine_content: the id of a piece from RECENT CONTENT'),
  instruction: z.string().nullable().describe('For refine_content / revise_strategy: what to change'),
  rule: z.string().nullable().describe('For add_rule: the rule, phrased as an instruction to the team'),
  summary: z.string().describe('One short line describing the action, shown on the confirm button; empty for none'),
})
export type AssistantAction = z.infer<typeof ActionSchema>

const ReplySchema = z.object({
  reply: z.string().describe('Your answer to the founder, in plain language'),
  action: ActionSchema,
})

const SYSTEM = `${CHARTER}

You are LYRA, the founder's marketing chief of staff. You know everything in the brief below.
- Answer questions directly and specifically, using the brief and the recent work. Say plainly when you don't know.
- If the founder asks you to DO something the team can do, propose exactly one action:
  run_agent (re-run one agent), refine_content (rewrite one listed piece), add_rule (a lasting preference for the whole team),
  revise_strategy (ask SAGE for a new draft). Otherwise action.type = "none".
- Never claim you've done something — actions only happen when the founder confirms.
- Keep replies short. Plain text, no markdown headings.`

export async function history(productId: string, limit = 40) {
  const { data } = await db().from('assistant_messages').select('*').eq('product_id', productId)
    .order('created_at', { ascending: false }).limit(limit)
  return (data ?? []).reverse()
}

export async function ask(productId: string, message: string) {
  const text = message.trim().slice(0, 4000)
  if (!text) throw new Error('Say something first')
  const supabase = db()
  const [brain, counts, past, { data: content }, { data: steps }] = await Promise.all([
    loadBrain(productId),
    pendingCounts(productId),
    history(productId, 16),
    supabase.from('content_items').select('id, platform, title, status, scheduled_at').eq('product_id', productId)
      .in('status', ['draft', 'approved']).order('scheduled_at').limit(15),
    supabase.from('run_steps').select('agent, status, detail, agent_runs!inner(product_id, started_at)')
      .eq('agent_runs.product_id', productId).order('started_at', { ascending: false, referencedTable: 'agent_runs' }).limit(12),
  ])

  await supabase.from('assistant_messages').insert({ product_id: productId, role: 'user', content: text })

  const convo = past.map(m => `${m.role === 'user' ? 'FOUNDER' : 'LYRA'}: ${m.content}`).join('\n')
  const { data } = await generateObject({ agent: 'assistant', productId }, {
    system: SYSTEM,
    schema: ReplySchema,
    maxOutputTokens: 2500,
    purpose: 'assistant',
    prompt: `${renderBrief(brain, { research: true, strategy: true, draftStrategy: true })}

## STATE
Strategy: ${brain.strategyStatus}. Waiting for the founder: ${counts.content} content drafts, ${counts.outreach} outreach targets${counts.strategy ? ', the strategy' : ''}.
Recent agent activity: ${(steps ?? []).map(s => `${AGENTS[s.agent as AgentKey]?.name ?? s.agent} ${s.status}${s.detail ? ` (${s.detail})` : ''}`).join('; ') || 'none'}
Agents that can be re-run: ${RUNNABLE.map(a => `${a} (${AGENTS[a].name})`).join(', ')}

## RECENT CONTENT (id — platform — title)
${(content ?? []).map(c => `${c.id} — ${c.platform} — ${c.title} [${c.status}]`).join('\n') || '(none)'}

## CONVERSATION SO FAR
${convo || '(new conversation)'}

FOUNDER: ${text}`,
  })

  const proposed = data.action.type !== 'none' ? data.action : null
  const { data: saved } = await supabase.from('assistant_messages').insert({
    product_id: productId, role: 'assistant', content: data.reply,
    action: proposed, action_status: proposed ? 'proposed' : null,
  }).select('*').single()
  return saved
}

/** Carry out an action LYRA proposed, after the founder confirms it. */
export async function confirmAction(messageId: string) {
  const supabase = db()
  const { data: msg } = await supabase.from('assistant_messages').select('*').eq('id', messageId).single()
  if (!msg?.action || msg.action_status !== 'proposed') throw new Error('Nothing to confirm')
  const action = ActionSchema.parse(msg.action)
  const productId = msg.product_id as string

  try {
    let result = ''
    switch (action.type) {
      case 'run_agent':
        if (!action.agent) throw new Error('No agent named')
        await startAgentRun(productId, action.agent)
        result = `${AGENTS[action.agent].name} is working on it.`
        break
      case 'refine_content': {
        if (!action.item_id || !action.instruction) throw new Error('Which piece, and what to change?')
        const { data: item } = await supabase.from('content_items').select('id').eq('id', action.item_id).eq('product_id', productId).maybeSingle()
        if (!item) throw new Error('That piece no longer exists')
        await refineItem('content_items', action.item_id, action.instruction)
        result = 'Rewritten — the previous version is in its history.'
        break
      }
      case 'add_rule':
        if (!action.rule) throw new Error('No rule given')
        await addHouseRule(productId, action.rule, 'manual')
        result = 'Added to your house rules. Every agent follows it from now on.'
        break
      case 'revise_strategy':
        if (!action.instruction) throw new Error('What should change?')
        await reviseStrategy(productId, action.instruction)
        result = 'SAGE is drafting a revised strategy for you to review.'
        break
      default:
        throw new Error('Nothing to do')
    }
    await supabase.from('assistant_messages').update({ action_status: 'done' }).eq('id', messageId)
    await supabase.from('assistant_messages').insert({ product_id: productId, role: 'assistant', content: result })
    return result
  } catch (err) {
    await supabase.from('assistant_messages').update({ action_status: 'failed' }).eq('id', messageId)
    throw err
  }
}

export async function dismissAction(messageId: string) {
  await db().from('assistant_messages').update({ action_status: 'dismissed' }).eq('id', messageId).eq('action_status', 'proposed')
}
