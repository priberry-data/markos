import { z } from 'zod'
import { CHARTER } from './charter'
import { db } from '@/lib/db'
import { generateObject } from '@/lib/llm'
import { loadBrain, renderBrief } from './brain'
import { applyModelSettings } from './execs/context'
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

/** Keep the item as it is now in its History. Returns the item and the id of the copy. */
async function snapshot(table: ItemTable, id: string, reason: string): Promise<{ row: Record<string, unknown>; version: string }> {
  const { data } = await db().from(table).select('*').eq('id', id).single()
  if (!data) throw new Error('Item not found')
  const { data: kept, error } = await db().from('item_versions').insert({ item_table: table, item_id: id, content: data, reason }).select('id').single()
  if (error || !kept) throw new Error(`Could not keep the previous version: ${error?.message ?? 'no copy was made'}`)
  return { row: data as Record<string, unknown>, version: kept.id as string }
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

export const APPROVE_RELOAD = 'Reload the page and approve again: MarkOS approves only the version on your screen.'
export const APPROVE_CHANGED = 'This changed since the page loaded (rewritten, edited or already approved), so it wasn’t approved. Look at it again, then approve.'

/**
 * Approve the version the founder is looking at. `version` is the piece's `updated_at` as their
 * card showed it, the exact string the database gave (never re-parsed): every change to a piece's
 * words moves it, so a rewrite that lands after the page loaded is never approved unseen. Only a
 * draft is approved, in one conditional write.
 */
export async function approveContent(id: string, version: string) {
  if (!version) throw new Error(APPROVE_RELOAD)
  const { data: item } = await db().from('content_items').select('title, body').eq('id', id).single()
  if (!item) throw new Error('Item not found')
  const gap = findPlaceholder(item.body) ?? findPlaceholder(item.title)
  if (gap) throw new Error(`This piece still contains ${gap}. Edit it first.`)
  const { data, error } = await db().from('content_items').update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'draft').eq('updated_at', version).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error(APPROVE_CHANGED)
}

export async function setContentStatus(id: string, status: 'posted' | 'draft') {
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

const GOING_OUT = 'This post is going out right now, so nothing was changed. Look at it again in a minute.'

/**
 * Save words the founder hasn't approved: an AI rewrite, or an earlier version put back. An
 * approved post goes back to draft in the same write, so it never goes out at its time unseen;
 * the founder's own edits keep their approval. (An outreach message keeps its stage: an email
 * goes out only when the founder presses Send on the card that shows its words.) Saved only while
 * the item's status is still what it was when `item` was read, so a post that went out (or was
 * rejected) in the meantime is left as it is; other changes made meanwhile, such as the founder's
 * own edit, are replaced, and kept in History. `version` is the copy just kept in History: when
 * nothing is saved it is removed again. Returns whether the item needs approving again.
 */
async function saveUnapproved(table: ItemTable, item: Record<string, unknown>, update: Record<string, unknown>, version: string): Promise<boolean> {
  const toDraft = table === 'content_items' && item.status === 'approved'
  let refused = item.status === 'posting' ? GOING_OUT : ''
  if (!refused) {
    let write = db().from(table).update({ ...update, ...(toDraft ? { status: 'draft' } : {}), updated_at: new Date().toISOString() }).eq('id', item.id as string)
    write = typeof item.status === 'string' ? write.eq('status', item.status) : write.is('status', null)
    const { data, error } = await write.select('id')
    if (error) refused = error.message
    else if (!data?.length) refused = 'This changed in the meantime (a post may have just gone out), so nothing was saved. Look at it again, then retry.'
  }
  if (refused) {
    // Nothing changed, so the copy would only clutter History.
    await db().from('item_versions').delete().eq('id', version)
    throw new Error(refused)
  }
  return toDraft
}

/**
 * "Make this shorter", "less salesy", "mention the free plan": one small call
 * that rewrites just this item in the brand voice, keeping the old version.
 */
export async function refineItem(table: ItemTable, id: string, instruction: string) {
  const how = instruction.trim()
  if (!how) throw new Error('Say how to change it')
  // The AI chosen in Settings, like every other piece of work.
  await applyModelSettings()
  const { data: item } = await db().from(table).select('*').eq('id', id).single()
  if (!item) throw new Error('Item not found')
  if (item.status === 'posting') throw new Error(GOING_OUT)
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
    const { version } = await snapshot('content_items', id, `refined: ${how.slice(0, 200)}`)
    const needsApproval = await saveUnapproved('content_items', item, { ...data, edited: true }, version)
    return { ...data, needsApproval }
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
  const { version } = await snapshot('outreach_targets', id, `refined: ${how.slice(0, 200)}`)
  const needsApproval = await saveUnapproved('outreach_targets', item, { draft_subject: data.draft_subject, outreach_draft: data.draft_message }, version)
  return { ...data, needsApproval }
}

/** Put a previous version back. An approved item goes back for approval: see saveUnapproved. */
export async function restoreVersion(versionId: string): Promise<{ needsApproval: boolean }> {
  const { data: v } = await db().from('item_versions').select('*').eq('id', versionId).single()
  if (!v) throw new Error('Version not found')
  const table = v.item_table as ItemTable
  const fields = table === 'content_items' ? CONTENT_FIELDS : OUTREACH_FIELDS
  const { row, version } = await snapshot(table, v.item_id, 'before restore')
  return { needsApproval: await saveUnapproved(table, row, pick(v.content, fields), version) }
}
