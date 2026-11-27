import { db } from '@/lib/db'

// An email goes out only with the words the founder was looking at, and only once.
//
// The Send button posts what its card showed: the row's `updated_at` (its version, kept as the
// exact string the database gave, never re-parsed) and the address, subject and body. A card from
// before the row's last change is refused first (409). Then the route
// claims the row in one conditional UPDATE (that version, and for outreach `sent_at` still empty),
// so two clicks, or two tabs, can't both send. The email is built from the row the claim returned,
// and only when its words are the ones the card showed. A failed send puts the row back.

/** What the card showed when the founder pressed Send. */
export interface Shown {
  version: string | null
  to: string | null
  subject: string | null
  body: string | null
  force: boolean
}

export async function readShown(req: Request): Promise<Shown> {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v : null)
  return { version: text(b.version), to: text(b.to), subject: text(b.subject), body: text(b.body), force: b.force === true }
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim()

/** The row says what the card showed: same address, subject and body. */
export function sameAsShown(row: { to: string | null; subject: string | null; body: string | null }, shown: Shown): boolean {
  return norm(row.to) === norm(shown.to) && norm(row.subject) === norm(shown.subject) && norm(row.body) === norm(shown.body)
}

export const RELOAD = 'Reload the page and send again: MarkOS sends only the message on your screen.'
export const CHANGED = 'This message changed since the page loaded, or it was just sent, so nothing was sent. Look at it again, then send.'

type SendTable = 'outreach_targets' | 'customers' | 'pipeline'

/**
 * The row is still at the version the card showed (compared in Postgres, as the claim is). The
 * routes ask this before anything else about the row, so a card from before its last change (a
 * send from another tab, a new draft) is told it's out of date (409, and the page reloads)
 * instead of being judged on words it no longer shows.
 */
export async function stillShown(table: SendTable, id: string, version: string): Promise<boolean> {
  const { data, error } = await db().from(table).select('id').eq('id', id).eq('updated_at', version)
  if (error) throw new Error(error.message)
  return Boolean(data?.length)
}

/**
 * Claim a row for sending: `claim` is written only if the row is still at `version` (and, when
 * given, column `stillEmpty` is still null, such as outreach's sent_at). Returns the row as it now
 * is, or null if it had changed.
 */
export async function claimForSend(table: SendTable, id: string, version: string, claim: Record<string, unknown>, stillEmpty?: string) {
  let q = db().from(table).update(claim).eq('id', id).eq('updated_at', version)
  if (stillEmpty) q = q.is(stillEmpty, null)
  const { data, error } = await q.select('*')
  if (error) throw new Error(error.message)
  return (data?.[0] ?? null) as Record<string, unknown> | null
}

/**
 * Put a claimed row back as it was before the claim (`before`, with its old `updated_at`), so the
 * card's Send works again. If something else wrote to the row meanwhile, that write's version
 * stays, and only what the claim changed and nobody has changed since goes back: a status or
 * stage still at the claim's value (`claim`), then `marker`, still holding this claim's stamp.
 * So a target removed, or a pitch dropped, while its email was going out stays removed or dropped.
 */
export async function unclaim(table: SendTable, id: string, stamp: string, before: Record<string, unknown>, claim: Record<string, unknown>, marker: string) {
  const { data } = await db().from(table).update(before).eq('id', id).eq('updated_at', stamp).select('id')
  if (data?.length) return
  for (const [field, value] of Object.entries(before)) {
    if (field === 'updated_at' || field === marker) continue
    await db().from(table).update({ [field]: value }).eq('id', id).eq(marker, stamp).eq(field, claim[field] as string)
  }
  await db().from(table).update({ [marker]: before[marker] }).eq('id', id).eq(marker, stamp)
}
