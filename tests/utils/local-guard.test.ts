import { afterEach, describe, expect, it } from 'vitest'
import { checkLocalRequest, readLocalToken, type LocalRequest } from '@/lib/utils/local-guard'

// No database and no server: the guard is a pure decision on the request's headers.
const TOKEN = 'a'.repeat(64)
const req = (over: Partial<LocalRequest>): LocalRequest => ({
  method: 'POST',
  host: 'localhost:3001',
  origin: null,
  secFetchSite: null,
  token: null,
  ...over,
})

describe('local guard', () => {
  afterEach(() => {
    delete process.env.MARKOS_LOCAL_TOKEN
  })

  it('lets the MarkOS window change things (same-origin requests)', () => {
    expect(checkLocalRequest(req({ origin: 'http://localhost:3001', secFetchSite: 'same-origin' }), TOKEN).ok).toBe(true)
    expect(checkLocalRequest(req({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001' }), TOKEN).ok).toBe(true)
  })

  it('refuses changes posted from another website', () => {
    expect(checkLocalRequest(req({ origin: 'https://evil.example' }), TOKEN).ok).toBe(false)
    // A page served by another program on this computer is another website too: same name, other port.
    expect(checkLocalRequest(req({ origin: 'http://localhost:5173' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ host: '127.0.0.1:3001', origin: 'http://127.0.0.1:8080' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ origin: 'http://localhost' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ origin: 'http://127.0.0.1:3001' }), TOKEN).ok).toBe(false) // the window at localhost never sends this
    // A form posted cross-site with the Origin stripped is still marked by the browser.
    expect(checkLocalRequest(req({ secFetchSite: 'cross-site' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ secFetchSite: 'same-site' }), TOKEN).ok).toBe(false)
  })

  it('refuses requests addressed to another name (DNS rebinding), even reads', () => {
    expect(checkLocalRequest(req({ method: 'GET', host: 'rebind.attacker.example:3001' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ method: 'GET', host: null }), TOKEN).ok).toBe(false)
  })

  it('needs the local token for changes from scripts (no Origin)', () => {
    expect(checkLocalRequest(req({}), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ token: 'wrong' }), TOKEN).ok).toBe(false)
    expect(checkLocalRequest(req({ token: TOKEN }), TOKEN).ok).toBe(true)
    // No token configured means no script access at all, never open access.
    expect(checkLocalRequest(req({ token: TOKEN }), null).ok).toBe(false)
  })

  it('leaves local reads open', () => {
    expect(checkLocalRequest(req({ method: 'GET' }), TOKEN).ok).toBe(true)
    expect(checkLocalRequest(req({ method: 'HEAD', host: '[::1]:3001' }), TOKEN).ok).toBe(true)
  })

  it('reads the token from MARKOS_LOCAL_TOKEN before the file', () => {
    process.env.MARKOS_LOCAL_TOKEN = ' t0k3n '
    expect(readLocalToken()).toBe('t0k3n')
  })
})
