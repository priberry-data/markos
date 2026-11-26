// Next.js proxy (formerly middleware): every request except static files passes the local guard.
// Pages too, not just /api: a DNS-rebound page could otherwise read the founder's data from a page GET.
import { NextResponse, type NextRequest } from 'next/server'
import { checkLocalRequest, readLocalToken, TOKEN_HEADER } from '@/lib/utils/local-guard'

export function proxy(req: NextRequest) {
  const verdict = checkLocalRequest(
    {
      method: req.method,
      host: req.headers.get('host'),
      origin: req.headers.get('origin'),
      secFetchSite: req.headers.get('sec-fetch-site'),
      token: req.headers.get(TOKEN_HEADER),
    },
    readLocalToken(),
  )
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason }, { status: 403 })
  return NextResponse.next()
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
