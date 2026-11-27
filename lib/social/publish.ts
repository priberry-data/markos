import { db } from '@/lib/db'
import { findPlaceholder } from '@/lib/engine/sources'
import { notify } from '@/lib/engine/store'

// Posting to X and LinkedIn — only ever what the founder approved.
//
// The founder's one-tap approval is the OK to go public; nothing an agent
// drafts is posted without it, and an AI rewrite of an approved piece sends it
// back to draft (lib/engine/items.ts). An approved piece goes out when its scheduled
// time arrives, if that platform is connected. If MarkOS isn't running at that
// time it goes out the next time it is, and the post records when it really
// went out.

export type SocialPlatform = 'twitter' | 'linkedin'

interface TokenRow {
  platform: string
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
  platform_user_id: string | null
}

export class PostError extends Error {
  constructor(message: string, readonly reconnect = false) {
    super(message)
    this.name = 'PostError'
  }
}

async function token(platform: SocialPlatform): Promise<TokenRow> {
  const { data } = await db().from('social_tokens').select('*').eq('platform', platform).maybeSingle()
  if (!data) throw new PostError(`${platform === 'twitter' ? 'X' : 'LinkedIn'} isn't connected. Connect it in Settings.`, true)
  const row = data as TokenRow
  const expiring = row.token_expires_at && Date.parse(row.token_expires_at) < Date.now() + 60_000
  if (platform === 'twitter' && expiring) return refreshTwitter(row)
  if (platform === 'linkedin' && expiring) throw new PostError('The LinkedIn connection expired. Reconnect it in Settings.', true)
  return row
}

/** X access tokens last two hours; the refresh token keeps posting working overnight. */
async function refreshTwitter(row: TokenRow): Promise<TokenRow> {
  const id = process.env.TWITTER_CLIENT_ID
  const secret = process.env.TWITTER_CLIENT_SECRET
  if (!row.refresh_token || !id || !secret) throw new PostError('The X connection expired. Reconnect it in Settings.', true)
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
  })
  if (!res.ok) throw new PostError('The X connection expired. Reconnect it in Settings.', true)
  const t = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }
  const next = {
    ...row,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? row.refresh_token,
    token_expires_at: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  }
  await db().from('social_tokens').update({
    access_token: next.access_token, refresh_token: next.refresh_token, token_expires_at: next.token_expires_at,
  }).eq('platform', 'twitter')
  return next
}

export async function postTo(platform: SocialPlatform, text: string): Promise<{ id: string; url: string | null }> {
  const gap = findPlaceholder(text)
  if (gap) throw new PostError(`The post still contains ${gap}.`)
  const t = await token(platform)

  if (platform === 'twitter') {
    if (text.length > 280) throw new PostError(`This post is ${text.length} characters; X allows 280. Shorten it first.`)
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (res.status === 401) throw new PostError('X rejected the connection. Reconnect it in Settings.', true)
    if (!res.ok) throw new PostError(`X refused the post: ${(await res.text()).slice(0, 200)}`)
    const id = ((await res.json()) as { data?: { id: string } }).data?.id ?? ''
    return { id, url: id ? `https://x.com/i/web/status/${id}` : null }
  }

  if (!t.platform_user_id) throw new PostError('The LinkedIn connection is missing your user id. Reconnect it in Settings.', true)
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: `urn:li:person:${t.platform_user_id}`,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  })
  if (res.status === 401) throw new PostError('LinkedIn rejected the connection. Reconnect it in Settings.', true)
  if (!res.ok) throw new PostError(`LinkedIn refused the post: ${(await res.text()).slice(0, 200)}`)
  const id = res.headers.get('x-restli-id') ?? ''
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null }
}

/** The text that goes out: the body, with hashtags if the piece has them and they aren't already in it. */
export function postText(item: { body: string | null; hashtags?: string[] | null }): string {
  const body = (item.body ?? '').trim()
  const tags = (item.hashtags ?? []).map(h => (h.startsWith('#') ? h : `#${h}`)).filter(h => !body.includes(h))
  return tags.length ? `${body}\n\n${tags.join(' ')}` : body
}

/** Post every approved piece whose time has come, on connected platforms. */
export async function publishDue(): Promise<{ posted: number; failed: number }> {
  const supabase = db()
  const { data: tokens } = await supabase.from('social_tokens').select('platform')
  const connected = (tokens ?? []).map(t => t.platform as string).filter(p => p === 'twitter' || p === 'linkedin')
  if (connected.length === 0) return { posted: 0, failed: 0 }

  const { data: due } = await supabase.from('content_items')
    .select('id, product_id, platform, title, body, hashtags, performance_json')
    .eq('status', 'approved').in('platform', connected).is('published_at', null)
    .lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(10)

  let posted = 0
  let failed = 0
  for (const item of due ?? []) {
    // Claim it first, so two tickers can never post the same piece twice.
    const { data: claimed } = await supabase.from('content_items').update({ status: 'posting' })
      .eq('id', item.id).eq('status', 'approved').select('id')
    if (!claimed?.length) continue
    try {
      const result = await postTo(item.platform as SocialPlatform, postText(item))
      await supabase.from('content_items').update({
        status: 'posted', published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        performance_json: { ...(item.performance_json as object ?? {}), post_id: result.id, post_url: result.url },
      }).eq('id', item.id)
      posted++
    } catch (err) {
      failed++
      const message = (err as Error).message
      // Back to approved, with the reason, so it's visible and can go out once fixed. Only if it is
      // still going out: a reject (or a move back to draft) while the post was in flight wins.
      await supabase.from('content_items').update({
        status: 'approved',
        performance_json: { ...(item.performance_json as object ?? {}), last_error: message, last_error_at: new Date().toISOString() },
      }).eq('id', item.id).eq('status', 'posting')
      await notify(item.product_id as string, {
        type: 'post_failed', title: `Couldn’t post “${item.title ?? 'a post'}”`, message, actionUrl: err instanceof PostError && err.reconnect ? '/settings' : '/content',
      })
      if (err instanceof PostError && err.reconnect) break   // the rest would fail the same way
    }
  }
  return { posted, failed }
}

let ticker: NodeJS.Timeout | null = null

/** Started once with the server: checks for due posts every five minutes. */
export function startPublisher() {
  if (ticker) return
  const tick = () => publishDue().catch(err => console.error('[publisher]', err))
  ticker = setInterval(tick, 5 * 60_000)
  ticker.unref?.()
  setTimeout(tick, 30_000).unref?.()
}
