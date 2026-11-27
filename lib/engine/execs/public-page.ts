// The text of a product's own public page, fetched by MarkOS itself — for an AI
// that can't browse. Only the URL the founder entered for their product.

const MAX_BYTES = 2 * 1024 * 1024
const MAX_TEXT = 15_000

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

function decode(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function htmlToText(html: string): string {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
  const desc = decode(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? '').trim()
  const body = decode(html
    .replace(/<head(\s[^>]*)?>[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|header|footer|main)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v\r\u00a0]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
  return [title && `Title: ${title}`, desc && `Description: ${desc}`, body].filter(Boolean).join('\n').slice(0, MAX_TEXT)
}

export async function readPublicPage(url: string): Promise<string | null> {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'text/html,text/plain' } })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      chunks.push(value)
      if (size > MAX_BYTES) { await reader.cancel(); break }
    }
    const text = htmlToText(Buffer.concat(chunks).toString('utf8'))
    return text || null
  } catch {
    return null
  }
}
