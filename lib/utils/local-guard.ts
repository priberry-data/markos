// Who may change things through MarkOS's API. MarkOS is single-user and local-only, so there is
// no login. That makes three outside callers worth stopping:
//  - another device on the same network (the server binds 127.0.0.1 only; see scripts/lib-start.sh and scripts/markos.mjs),
//  - a web page in the founder's browser posting to localhost:3001 (cross-site request), including
//    a page served by another program on this computer (same name, another port: another website),
//  - a page whose own domain resolves to 127.0.0.1 (DNS rebinding: the Host header gives it away).
// Reads (GET/HEAD/OPTIONS) stay open to local callers. Changes need either the MarkOS window
// itself (a same-origin request) or the local token (the night shift and scripts).
import { readFileSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { supportDir } from './app-dirs'

export const TOKEN_FILE = path.join(/*turbopackIgnore: true*/ supportDir(), 'local-token')
export const TOKEN_HEADER = 'x-markos-token'

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The hostname in a Host header or an Origin URL, or null when it can't be read. */
export function hostnameOf(value: string | null, isOrigin = false): string | null {
  if (!value) return null
  try {
    return new URL(isOrigin ? value : `http://${value}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** "localhost:3001" for a Host header or an Origin URL, with the scheme's default port filled in. */
function hostAndPort(value: string, isOrigin: boolean): string | null {
  try {
    const u = new URL(isOrigin ? value : `http://${value}`)
    return `${u.hostname.toLowerCase()}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return null
  }
}

export function isLocalName(hostname: string | null): boolean {
  return hostname !== null && LOCAL_NAMES.has(hostname)
}

/** The token the night shift and scripts present. MARKOS_LOCAL_TOKEN wins (tests); else the file. */
export function readLocalToken(): string | null {
  const fromEnv = process.env.MARKOS_LOCAL_TOKEN?.trim()
  if (fromEnv) return fromEnv
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim() || null
  } catch {
    return null
  }
}

function sameToken(given: string | null, expected: string | null): boolean {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface LocalRequest {
  method: string
  host: string | null
  origin: string | null
  secFetchSite: string | null
  token: string | null
}

export type Verdict = { ok: true } | { ok: false; reason: string }

export function checkLocalRequest(req: LocalRequest, expectedToken: string | null): Verdict {
  if (!isLocalName(hostnameOf(req.host))) return { ok: false, reason: 'MarkOS only answers requests addressed to this computer.' }
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true }
  if (req.origin && req.origin !== 'null') {
    // Only the MarkOS window itself: the very name and port this request was sent to.
    const origin = hostAndPort(req.origin, true)
    return origin !== null && origin === hostAndPort(req.host!, false)
      ? { ok: true }
      : { ok: false, reason: 'Changes from another website are refused.' }
  }
  // No Origin: a browser marks cross-site requests anyway; anything else must carry the token.
  if (req.secFetchSite && req.secFetchSite !== 'same-origin' && req.secFetchSite !== 'none') {
    return { ok: false, reason: 'Changes from another website are refused.' }
  }
  return sameToken(req.token, expectedToken)
    ? { ok: true }
    : { ok: false, reason: `Changes need the MarkOS window or the local token (${TOKEN_HEADER}).` }
}
