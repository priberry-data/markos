import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { findPlaceholder } from '../sources'
import { CustomerDraftSchema, CustomerSynthesisSchema, type CustomerSynthesis } from '../schemas'
import { applyModelSettings, workContext } from './context'
import { systemFor } from './roster'
import { createTasks } from './tasks'
import { post } from './team-room'

// The Customer team. It only ever talks to people the founder added, only
// through drafts the founder approves, and it turns every conversation into
// work: bugs become issues for QA and the CTO, requests go to the CPO, and
// the customer's own words go to the CMO.

const DAY = 86400_000

/** The founder pasted a conversation: make sense of it and route it. */
export async function synthesiseNote(productId: string, content: string, customerId: string | null = null): Promise<CustomerSynthesis> {
  const text = content.trim()
  if (text.length < 20) throw new Error('Paste the conversation or notes first')
  await applyModelSettings()
  const ctx = await workContext(productId)
  const { data } = await generateObject({ agent: 'cx', productId }, {
    system: systemFor('cx'),
    prompt: `${ctx.text}\n\n## CONVERSATION OR NOTES FROM THE FOUNDER\n"""${text.slice(0, 20_000)}"""\n\nSynthesise it. Quotes must be copied exactly from the text above.`,
    schema: CustomerSynthesisSchema,
    purpose: 'customer notes',
  })

  // A quote is kept only if it really is in the notes.
  const normal = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const haystack = normal(text)
  const synthesis: CustomerSynthesis = {
    ...data,
    quotes: data.quotes.filter(q => haystack.includes(normal(q).replace(/^["“']|["”']$/g, ''))),
    follow_up: data.follow_up && !findPlaceholder(data.follow_up.body) && !findPlaceholder(data.follow_up.subject) ? data.follow_up : null,
  }

  const supabase = db()
  const { error } = await supabase.from('customer_notes').insert({ product_id: productId, customer_id: customerId, content: text, synthesis })
  if (error) throw new Error(`Could not save the notes: ${error.message}`)

  for (const b of synthesis.bugs) {
    const { error: issueError } = await supabase.from('issues').upsert({
      product_id: productId, title: b.title, severity: b.severity, evidence: `A customer said: ${b.evidence}`,
      area: 'reported by a customer', origin: 'customer', status: 'open', updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id,title' })
    if (issueError) throw new Error(`Could not file the issue: ${issueError.message}`)
  }
  const work = [
    synthesis.feature_requests.length && { exec: 'cpo' as const, task: `Customers asked for: ${synthesis.feature_requests.join('; ')}. Assess each against the roadmap and say which, if any, to build.` },
    synthesis.bugs.some(b => b.severity === 'critical' || b.severity === 'high') && { exec: 'cto' as const, task: `A customer reported: ${synthesis.bugs.filter(b => b.severity === 'critical' || b.severity === 'high').map(b => b.title).join('; ')}. Find the cause in the repo and propose the fix.` },
    synthesis.for_marketing.length && { exec: 'cmo' as const, task: `Use these customer words in messaging (ask permission before quoting by name): ${synthesis.for_marketing.join('; ')}` },
  ].filter(Boolean) as Array<{ exec: 'cpo' | 'cto' | 'cmo'; task: string }>
  const ids = await createTasks(work.map(w => ({ ...w, productId, origin: 'cx', why: 'From a customer conversation' })))
  await post({ speaker: 'cx', kind: 'report', productId, content: `New customer conversation: ${synthesis.summary}${synthesis.quotes[0] ? `\n“${synthesis.quotes[0]}”` : ''}` })
  await Promise.all(work.map((w, i) => post({ speaker: 'cx', kind: 'handoff', to: [w.exec], productId, taskId: ids[i], content: w.task })))

  if (customerId && synthesis.follow_up) {
    await supabase.from('customers').update({
      draft_subject: synthesis.follow_up.subject, draft_body: synthesis.follow_up.body, draft_purpose: 'follow-up', updated_at: new Date().toISOString(),
    }).eq('id', customerId)
  }
  return synthesis
}

/** Draft this week's conversations: people not contacted in a while, without a draft waiting. */
export async function draftOutreach(productId: string, signal?: AbortSignal): Promise<number> {
  const supabase = db()
  const { data: people } = await supabase.from('customers').select('id, name, company, segment, notes, last_contacted_at, draft_body')
    .eq('product_id', productId)
  const due = (people ?? []).filter(p => !p.draft_body && (!p.last_contacted_at || Date.now() - Date.parse(p.last_contacted_at as string) > 14 * DAY)).slice(0, 5)
  if (due.length === 0) return 0

  await applyModelSettings()
  const ctx = await workContext(productId)
  const { data } = await generateObject({ agent: 'cx', productId, signal }, {
    system: systemFor('cx'),
    prompt: `${ctx.text}\n\n## CUSTOMERS DUE A CONVERSATION\n${due.map(p => `- id ${p.id}: ${p.name}${p.company ? ` (${p.company})` : ''}${p.segment ? ` — ${p.segment}` : ''}${p.notes ? ` — notes: ${p.notes}` : ''}${p.last_contacted_at ? ` — last contacted ${String(p.last_contacted_at).slice(0, 10)}` : ' — never contacted'}`).join('\n')}\n\nDraft one short, personal email to each, from the founder, with one ask (usually a 15-minute call). Use each person's real name. No placeholders.`,
    schema: CustomerDraftSchema,
    purpose: 'customer outreach',
  })
  let saved = 0
  const ids = new Set(due.map(p => p.id as string))
  for (const d of data.drafts) {
    if (!ids.has(d.customer_id) || findPlaceholder(d.body) || findPlaceholder(d.subject)) continue
    await supabase.from('customers').update({
      draft_subject: d.subject, draft_body: d.body, draft_purpose: d.purpose, updated_at: new Date().toISOString(),
    }).eq('id', d.customer_id)
    saved++
  }
  return saved
}

export async function customerFacts(productId: string): Promise<string> {
  const supabase = db()
  const [{ data: people }, { data: notes }] = await Promise.all([
    supabase.from('customers').select('name, segment, last_contacted_at, draft_body').eq('product_id', productId),
    supabase.from('customer_notes').select('synthesis, created_at').eq('product_id', productId).order('created_at', { ascending: false }).limit(5),
  ])
  const list = people ?? []
  const quiet = list.filter(p => !p.last_contacted_at || Date.now() - Date.parse(p.last_contacted_at as string) > 30 * DAY).length
  return [
    `Customers on file: ${list.length}; not contacted in 30+ days: ${quiet}; drafts waiting for the founder: ${list.filter(p => p.draft_body).length}`,
    `Recent conversations:\n${(notes ?? []).map(n => `- ${String(n.created_at).slice(0, 10)}: ${(n.synthesis as CustomerSynthesis | null)?.summary ?? '(not synthesised)'}`).join('\n') || '- none yet — the founder hasn’t added any'}`,
  ].join('\n')
}
