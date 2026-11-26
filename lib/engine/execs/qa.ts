import { db } from '@/lib/db'
import { post } from './team-room'

// QA's live checks, done by code: fetch each product's key pages and record
// what actually came back. A failing page becomes an issue on its own; a page
// that recovers closes the issue it opened. The QA lead (a model) reads these
// results — it never invents them.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 MarkOS-QA'
const ERROR_TEXT = /application error|internal server error|something went wrong|unhandled runtime error|504 gateway|502 bad gateway|this page could not be found/i
const SLOW_MS = 3000

export interface Check { url: string; status: number | null; ms: number; ok: boolean; problem: string | null }

async function check(url: string): Promise<Check> {
  const started = Date.now()
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    const ms = Date.now() - started
    const text = (await res.text()).slice(0, 200_000)
    // Bot protection (Cloudflare challenge) is not a broken page — it's a page we couldn't see.
    if ((res.status === 403 || res.status === 503) && (res.headers.get('cf-mitigated') || /cloudflare|just a moment/i.test(text))) {
      return { url, status: res.status, ms, ok: true, problem: 'blocked by bot protection — not checked' }
    }
    if (res.status >= 400) return { url, status: res.status, ms, ok: false, problem: `returned HTTP ${res.status}` }
    const err = text.match(ERROR_TEXT)
    if (err) return { url, status: res.status, ms, ok: false, problem: `page shows “${err[0]}”` }
    if (!/<title>[^<]{2,}<\/title>/i.test(text)) return { url, status: res.status, ms, ok: true, problem: 'no page title' }
    if (ms > SLOW_MS) return { url, status: res.status, ms, ok: true, problem: `slow: ${(ms / 1000).toFixed(1)}s` }
    return { url, status: res.status, ms, ok: true, problem: null }
  } catch (err) {
    const name = (err as Error).name
    return { url, status: null, ms: Date.now() - started, ok: false, problem: name === 'TimeoutError' ? 'no response in 15s' : `unreachable: ${(err as Error).message.slice(0, 80)}` }
  }
}

/** One address per page: no trailing slash, no fragment, no tracking parameters. */
function canonical(u: string): string {
  try {
    const url = new URL(u.replace(/&amp;/g, '&'))
    url.hash = ''
    for (const k of [...url.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/.test(k)) url.searchParams.delete(k)
    return url.toString().replace(/\/$/, '').replace(/\/\?/, '?')
  } catch {
    return u
  }
}

// Pages worth checking first when a site doesn't list its pages: the money path.
const KEY_PATHS = /pricing|plans|sign-?up|register|login|sign-?in|checkout|billing|demo|contact|apply|get-started|start/i

async function text(url: string, ms = 10_000): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) })
    return res.ok ? await res.text() : ''
  } catch {
    return ''
  }
}

/**
 * The home page plus up to 7 more on the same host: from the sitemap (following
 * a sitemap index one level, and robots.txt's Sitemap line), else from the
 * home page's own links — sign-up, pricing and login first.
 */
async function pagesFor(base: string): Promise<string[]> {
  const home = canonical(base)
  let host: string
  try { host = new URL(base).host } catch { return [home] }
  const urls = new Set<string>([home])
  const add = (u: string) => {
    try {
      const abs = canonical(new URL(u, base).toString())
      if (new URL(abs).host === host && !/\.(xml|png|jpe?g|svg|webp|gif|ico|pdf|css|js|mjs|json|txt|woff2?|ttf|otf|webmanifest|mp4|webm|mp3|zip)(\?|$)/i.test(abs)) urls.add(abs)
    } catch {}
  }

  const robots = await text(new URL('/robots.txt', base).toString())
  const sitemaps = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map(m => m[1])
  if (sitemaps.length === 0) sitemaps.push(new URL('/sitemap.xml', base).toString())
  for (const sm of sitemaps.slice(0, 2)) {
    const xml = await text(sm)
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])
    const children = locs.filter(l => /\.xml(\?|$)/i.test(l)).slice(0, 2)
    for (const l of locs) if (!/\.xml(\?|$)/i.test(l)) add(l)
    for (const child of children) {
      for (const m of (await text(child)).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) add(m[1])
    }
  }

  if (urls.size < 4) {
    const html = await text(base)
    const links = [...html.matchAll(/href=["']([^"'#]+)["']/g)].map(m => m[1]).filter(h => !h.startsWith('mailto:') && !h.startsWith('tel:'))
    for (const l of [...links.filter(l => KEY_PATHS.test(l)), ...links]) add(l)
  }

  // Key pages first, then the rest, eight in all.
  const all = [...urls]
  return [home, ...all.filter(u => u !== home && KEY_PATHS.test(u)), ...all.filter(u => u !== home && !KEY_PATHS.test(u))].slice(0, 8)
}

export async function runChecks(productId: string): Promise<Check[]> {
  const supabase = db()
  const { data: product } = await supabase.from('products').select('url').eq('id', productId).single()
  if (!product?.url) return []
  const checks = await Promise.all((await pagesFor(product.url)).map(check))
  const home = canonical(product.url)

  const { error } = await supabase.from('qa_checks').insert(checks.map(c => ({
    product_id: productId, url: c.url, status: c.status, ms: c.ms, ok: c.ok, problem: c.problem,
  })))
  if (error) throw new Error(`Could not save QA checks: ${error.message}`)

  // Failing pages open (or keep) an issue; recovered pages close the one they opened.
  for (const c of checks) {
    const title = `Live page failing: ${c.url}`
    if (!c.ok) {
      const { data: existing } = await supabase.from('issues').select('id').eq('product_id', productId).eq('title', title).eq('status', 'open').maybeSingle()
      if (!existing) await post({ speaker: 'qa', kind: 'issue', to: ['cto'], productId, content: `${title} — ${c.problem}` })
      const { error: issueError } = await supabase.from('issues').upsert({
        product_id: productId, title, severity: c.url === home ? 'critical' : 'high',
        evidence: `${c.problem} (checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
        area: 'live site', origin: 'monitor', status: 'open', updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id,title' })
      if (issueError) throw new Error(`Could not file the issue: ${issueError.message}`)
    } else {
      await supabase.from('issues').update({ status: 'fixed', updated_at: new Date().toISOString() })
        .eq('product_id', productId).eq('title', title).eq('status', 'open').eq('origin', 'monitor')
    }
  }
  return checks
}

export async function qaFacts(productId: string): Promise<string> {
  const supabase = db()
  const [{ data: checks }, { data: issues }] = await Promise.all([
    supabase.from('qa_checks').select('url, status, ms, ok, problem, checked_at').eq('product_id', productId)
      .order('checked_at', { ascending: false }).limit(16),
    supabase.from('issues').select('title, severity, status, origin, evidence').eq('product_id', productId)
      .eq('status', 'open').order('created_at').limit(30),
  ])
  const latest = new Map<string, NonNullable<typeof checks>[number]>()
  for (const c of checks ?? []) if (!latest.has(c.url as string)) latest.set(c.url as string, c)
  return [
    `Live checks (latest per page):\n${[...latest.values()].map(c => `- ${c.ok ? 'OK' : 'FAIL'} ${c.url} — ${c.status ?? 'no response'}, ${c.ms}ms${c.problem ? `, ${c.problem}` : ''}`).join('\n') || '- no checks yet'}`,
    `Open issues:\n${(issues ?? []).map(i => `- [${i.severity}] ${i.title} (${i.origin})`).join('\n') || '- none'}`,
  ].join('\n\n')
}
