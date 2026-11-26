import { z } from 'zod'
import { CHARTER } from './charter'
import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { loadBrain, renderBrief } from './brain'
import { findPlaceholder } from './sources'

// What the founder does with individual pieces of output: edit, approve,
// reject (with a reason that teaches the team), refine with an instruction,
// mark as posted. Every change keeps the previous version.
//
// In the old build approving or rejecting changed nothing downstream, edits
// were never saved, and there were two approval queues that didn't sync.

type ItemTable = 'content_items' | 'outreach_targets'

const CONTENT_FIELDS = ['title', 'hook', 'body', 'hashtags', 'cta', 'scheduled_at', 'platform'] as const
const OUTREACH_FIELDS = ['outreach_draft', 'draft_subject', 'handle_or_email'] as const

async function snapshot(table: ItemTable, id: string, reason: string) {
  const { data } = await db().from(table).select('*').eq('id', id).single()
  if (!data) throw new Error('Item not found')
  const { error } = await db().from('item_versions').insert({ item_table: table, item_id: id, content: data, reason })
  if (error) throw new Error(`Could not keep the previous version: ${error.message}`)
  return data as Record<string, unknown>
}

function pick(obj: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => fields.includes(k) && v !== undefined))
}

// ── content pieces ──────────────────────────────────────────────────────────

export async function editContent(id: string, patch: Record<string, unknown>) {
  const update = pick(patch, CONTENT_FIELDS)
  if (Object.keys(update).length === 0) throw new Error('Nothing to change')
  await snapshot('content_items', id, 'edited')
  const { error } = await db().from('content_items')
    .update({ ...update, edited: true, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setContentStatus(id: string, status: 'approved' | 'posted' | 'draft') {
  const { data: item } = await db().from('content_items').select('title, body').eq('id', id).single()
  if (!item) throw new Error('Item not found')
  if (status !== 'draft') {
    const gap = findPlaceholder(item.body) ?? findPlaceholder(item.title)
    if (gap) throw new Error(`This piece still contains ${gap}. Edit it first.`)
  }
  const { error } = await db().from('content_items').update({
    status,
    ...(status === 'posted' ? { published_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── outreach drafts ─────────────────────────────────────────────────────────

export async function editOutreach(id: string, patch: Record<string, unknown>) {
  const update = pick(patch, OUTREACH_FIELDS)
  if (Object.keys(update).length === 0) throw new Error('Nothing to change')
  await snapshot('outreach_targets', id, 'edited')
  const extra: Record<string, unknown> = { updated_at: new Date().toISOString() }
  // Typing or confirming an address is what makes it sendable.
  if (typeof update.handle_or_email === 'string') extra.contact_confirmed = update.handle_or_email.includes('@')
  const { error } = await db().from('outreach_targets').update({ ...update, ...extra }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function confirmContact(id: string) {
  const { data } = await db().from('outreach_targets').select('handle_or_email').eq('id', id).single()
  if (!data?.handle_or_email?.includes('@')) throw new Error('There is no email address to confirm. Add one first.')
  const { error } = await db().from('outreach_targets').update({ contact_confirmed: true }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setOutreachStatus(id: string, status: string) {
  const allowed = ['identified', 'approved', 'contacted', 'replied', 'in_talks', 'closed', 'not_a_fit']
  if (!allowed.includes(status)) throw new Error('Unknown status')
  const { error } = await db().from('outreach_targets').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── rejecting teaches the team ──────────────────────────────────────────────

/**
 * Reject a draft. A reason, if given, becomes a house rule that every agent
 * follows from the next run on ("too salesy" → no more salesy posts).
 */
export async function rejectItem(table: ItemTable, id: string, reason?: string) {
  const { data: item } = await db().from(table).select('product_id').eq('id', id).single()
  if (!item) throw new Error('Item not found')
  const { error } = await db().from(table)
    .update({ status: 'rejected', rejected_reason: reason?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)

  const why = reason?.trim()
  if (why) {
    const kind = table === 'content_items' ? 'content' : 'outreach messages'
    await addHouseRule(item.product_id, `For ${kind}: avoid what the founder rejected as "${why.slice(0, 200)}"`, 'rejection')
  }
}

export async function addHouseRule(productId: string, rule: string, origin: 'manual' | 'rejection' | 'edit' | 'review' = 'manual') {
  const text = rule.trim()
  if (!text) throw new Error('A rule needs some text')
  const { data: existing } = await db().from('house_rules').select('id').eq('product_id', productId).eq('rule', text).eq('active', true).maybeSingle()
  if (existing) return existing.id as string
  const { data, error } = await db().from('house_rules').insert({ product_id: productId, rule: text, origin }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id as string
}

// ── refine one item with an instruction ─────────────────────────────────────

const RefinedContent = z.object({
  title: z.string(), hook: z.string(), body: z.string(), hashtags: z.array(z.string()), cta: z.string(),
})
const RefinedOutreach = z.object({ draft_subject: z.string().nullable(), draft_message: z.string() })

/**
 * "Make this shorter", "less salesy", "mention the free plan": one small call
 * that rewrites just this item in the brand voice, keeping the old version.
 */
export async function refineItem(table: ItemTable, id: string, instruction: string) {
  const how = instruction.trim()
  if (!how) throw new Error('Say how to change it')
  const { data: item } = await db().from(table).select('*').eq('id', id).single()
  if (!item) throw new Error('Item not found')
  const brain = await loadBrain(item.product_id)
  const brief = renderBrief(brain)

  if (table === 'content_items') {
    const { data } = await generateObject({ agent: 'content', productId: item.product_id }, {
      system: `${CHARTER}\n\nYou are NOVA, the content lead. Rewrite one piece exactly as the founder asks, in the brand voice from the brief. Keep what they didn't ask to change. No placeholders like [Name].`,
      schema: RefinedContent,
      maxOutputTokens: item.platform === 'blog' ? 6000 : 2500,
      purpose: 'refine:content',
      prompt: `${brief}

## THE PIECE (${item.platform})
Title: ${item.title}
Hook: ${item.hook ?? ''}
Body:
${item.body}
Hashtags: ${(item.hashtags ?? []).join(' ')}
CTA: ${item.cta ?? ''}

## THE FOUNDER'S INSTRUCTION
${how}`,
    })
    await snapshot('content_items', id, `refined: ${how.slice(0, 200)}`)
    const { error } = await db().from('content_items').update({ ...data, edited: true, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    return data
  }

  const { data } = await generateObject({ agent: 'distribution', productId: item.product_id }, {
    system: `${CHARTER}\n\nYou are REACH, the distribution lead. Rewrite one outreach message exactly as the founder asks. Keep it personal, short and useful to the recipient. No placeholders like [Name].`,
    schema: RefinedOutreach,
    maxOutputTokens: 1500,
    purpose: 'refine:outreach',
    prompt: `${brief}

## THE MESSAGE — to ${item.name} (${item.platform})
Why they fit: ${item.why_good_fit ?? ''}
Subject: ${item.draft_subject ?? '(none)'}
Message:
${item.outreach_draft}

## THE FOUNDER'S INSTRUCTION
${how}`,
  })
  await snapshot('outreach_targets', id, `refined: ${how.slice(0, 200)}`)
  const { error } = await db().from('outreach_targets')
    .update({ draft_subject: data.draft_subject, outreach_draft: data.draft_message, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  return data
}

/** Put a previous version back. */
export async function restoreVersion(versionId: string) {
  const { data: v } = await db().from('item_versions').select('*').eq('id', versionId).single()
  if (!v) throw new Error('Version not found')
  const table = v.item_table as ItemTable
  const fields = table === 'content_items' ? CONTENT_FIELDS : OUTREACH_FIELDS
  await snapshot(table, v.item_id, 'before restore')
  const { error } = await db().from(table).update(pick(v.content, fields)).eq('id', v.item_id)
  if (error) throw new Error(error.message)
}
