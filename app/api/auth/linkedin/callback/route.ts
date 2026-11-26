import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = req.cookies.get('linkedin_oauth_state')?.value

  const host = req.headers.get('host') ?? 'localhost:3001'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${proto}://${host}`

  if (!code || state !== storedState) {
    return NextResponse.redirect(`${baseUrl}/settings?error=linkedin_oauth_failed`)
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID!
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!
  const redirectUri = `${baseUrl}/api/auth/linkedin/callback`

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!tokenRes.ok) return NextResponse.redirect(`${baseUrl}/settings?error=linkedin_token_failed`)

  const tokens = await tokenRes.json() as { access_token: string; expires_in?: number }

  // Get LinkedIn user ID via OpenID userinfo
  const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  })
  const me = await meRes.json() as { sub?: string; name?: string; email?: string }

  const supabase = db()

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null

  await supabase.from('social_tokens').upsert({
    platform: 'linkedin',
    access_token: tokens.access_token,
    refresh_token: null,
    token_expires_at: expiresAt,
    username: me.name ?? me.email ?? null,
    platform_user_id: me.sub ?? null,
  }, { onConflict: 'platform' })

  const response = NextResponse.redirect(`${baseUrl}/settings?connected=linkedin`)
  response.cookies.delete('linkedin_oauth_state')
  return response
}
