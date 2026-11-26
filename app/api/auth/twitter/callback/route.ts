import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = req.cookies.get('twitter_oauth_state')?.value
  const codeVerifier = req.cookies.get('twitter_code_verifier')?.value

  const host = req.headers.get('host') ?? 'localhost:3001'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  if (!code || state !== storedState || !codeVerifier) {
    return NextResponse.redirect(`${baseUrl}/settings?error=twitter_oauth_failed`)
  }

  const clientId = process.env.TWITTER_CLIENT_ID!
  const clientSecret = process.env.TWITTER_CLIENT_SECRET!
  const redirectUri = `${baseUrl}/api/auth/twitter/callback`

  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  })

  if (!tokenRes.ok) return NextResponse.redirect(`${baseUrl}/settings?error=twitter_token_failed`)

  const tokens = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in?: number }

  // Get Twitter user info
  const meRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  })
  const me = await meRes.json() as { data?: { id: string; username: string } }
  const twitterUser = me.data

  const supabase = db()

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null

  await supabase.from('social_tokens').upsert({
    platform: 'twitter',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    token_expires_at: expiresAt,
    username: twitterUser?.username ?? null,
    platform_user_id: twitterUser?.id ?? null,
  }, { onConflict: 'platform' })

  const response = NextResponse.redirect(`${baseUrl}/settings?connected=twitter`)
  response.cookies.delete('twitter_code_verifier')
  response.cookies.delete('twitter_oauth_state')
  return response
}
