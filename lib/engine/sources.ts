import type { Source } from '@/lib/llm/types'

// Whether a cited source is genuine is decided here, not by the model.
//
// Agents may only cite URLs the web search actually returned. After every
// structured reply we walk it: any `source` URL that isn't one of the search's
// sources is removed and counted. So everywhere in MarkOS, a non-null source is
// a page that was really retrieved, and an item without one is shown as
// unverified. The old agents were told to "name real influencers / journalists
// / investors" with no search at all, and invented them.

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hash = ''
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'fbclid' || key === 'gclid') u.searchParams.delete(key)
    }
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host.toLowerCase().replace(/^www\./, '')}${path}${u.search}`
  } catch {
    return raw.trim()
  }
}

export interface VerifyResult<T> {
  data: T
  /** Citations that were removed because the search never returned them. */
  removed: string[]
}

/**
 * Keep only citations that match a real search result. Matching is by
 * normalized URL; a citation to a different page on the same site as a real
 * source is kept too, since search results often cite a site's home page.
 */
export function verifySources<T>(data: T, known: Source[]): VerifyResult<T> {
  const exact = new Set(known.map(s => normalizeUrl(s.url)))
  const hosts = new Set(known.map(s => hostOf(s.url)).filter(Boolean))
  const removed: string[] = []

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'source' && typeof value === 'string') {
        const ok = exact.has(normalizeUrl(value)) || hosts.has(hostOf(value))
        if (!ok) removed.push(value)
        out[key] = ok ? value : null
      } else {
        out[key] = walk(value)
      }
    }
    return out
  }

  return { data: walk(data) as T, removed }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Template gaps like [Name] or [Company] that must never reach a real person. */
const PLACEHOLDER = /\[(?:[A-Z][\w .'-]{0,40}|your [\w .'-]{1,40}|insert [\w .'-]{1,40})\]|\{\{[^}]{1,40}\}\}/

export function findPlaceholder(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(PLACEHOLDER)
  return m ? m[0] : null
}
