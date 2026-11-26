import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const clientId = process.env.LINKEDIN_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'LINKEDIN_CLIENT_ID not configured' }, { status: 500 })

  const state = crypto.randomBytes(16).toString('hex')
  const host = req.headers.get('host') ?? 'localhost:3001'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const redirectUri = `${proto}://${host}/api/auth/linkedin/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid profile w_member_social',
    state,
  })

  const response = NextResponse.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`)
  response.cookies.set('linkedin_oauth_state', state, { httpOnly: true, maxAge: 600, sameSite: 'lax' })
  return response
}
