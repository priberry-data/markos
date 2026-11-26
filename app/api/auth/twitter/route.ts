import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const clientId = process.env.TWITTER_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'TWITTER_CLIENT_ID not configured' }, { status: 500 })

  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = crypto.randomBytes(16).toString('hex')

  const host = req.headers.get('host') ?? 'localhost:3001'
  const proto = host.includes('localhost') ? 'http' : 'https'
  const redirectUri = `${proto}://${host}/api/auth/twitter/callback`

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  const response = NextResponse.redirect(`https://twitter.com/i/oauth2/authorize?${params}`)
  response.cookies.set('twitter_code_verifier', codeVerifier, { httpOnly: true, maxAge: 600, sameSite: 'lax' })
  response.cookies.set('twitter_oauth_state', state, { httpOnly: true, maxAge: 600, sameSite: 'lax' })
  return response
}
