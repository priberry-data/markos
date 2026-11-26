import { db } from '@/lib/db'
import { getActiveProduct } from '@/lib/products/active'
import { ResearchSchema } from '@/lib/engine/schemas'
import { verifySources } from '@/lib/engine/sources'
import { BookOpen, ExternalLink, AlertCircle, Users, Swords, MessageCircleQuestion, Target, HelpCircle } from 'lucide-react'
import { RunWatcher } from '@/components/engine/run-watcher'
import { StartLaunchButton } from '@/components/engine/start-launch-button'

export const dynamic = 'force-dynamic'

const card = 'bg-mk-card border border-mk-line rounded-2xl p-5'

/** A citation: a real, clickable page — or an honest "unverified". */
function Cite({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span title="No web source backs this — treat it as the agent's inference" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-mk-warn/80 ml-2">
        <AlertCircle className="w-3 h-3" /> unverified
      </span>
    )
  }
  let host = url
  try { host = new URL(url).host.replace(/^www\./, '') } catch {}
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-mk-accent hover:underline ml-2 whitespace-nowrap">
      {host} <ExternalLink className="w-3 h-3" />
    </a>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-mk-accent" />
        <h2 className="font-semibold text-mk-text">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default async function ResearchPage() {
  const supabase = db()
  const { product } = await getActiveProduct(supabase)
  if (!product) return null

  const [{ data: brain }, { data: sources }] = await Promise.all([
    supabase.from('product_brains').select('research, updated_at').eq('product_id', product.id).maybeSingle(),
    supabase.from('sources').select('url, title, retrieved_at').eq('product_id', product.id).order('retrieved_at', { ascending: false }),
  ])
  const parsed = brain?.research ? ResearchSchema.safeParse(brain.research) : null
  // Defence in depth: even stored data may only link to pages we actually
  // retrieved. Anything else renders as unverified.
  const r = parsed?.success
    ? verifySources(parsed.data, [...(sources ?? []).map(s => ({ url: s.url, title: s.title ?? '' })), { url: product.url as string, title: '' }]).data
    : null

  if (!r) {
    return (
      <div className="p-8 max-w-4xl">
        <RunWatcher productId={product.id} />
        <h1 className="text-2xl font-bold text-mk-text flex items-center gap-3 mb-6"><BookOpen className="w-6 h-6 text-mk-accent" /> Research</h1>
        <div className="bg-mk-card border border-dashed border-mk-line rounded-2xl p-12 text-center">
          <p className="text-mk-body font-medium">No research yet</p>
          <p className="text-sm text-mk-muted mt-1 mb-5">REX reads your website and searches the live web for your market, competitors and audience.</p>
          <StartLaunchButton productId={product.id} />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl space-y-5">
      <RunWatcher productId={product.id} />
      <div>
        <h1 className="text-2xl font-bold text-mk-text flex items-center gap-3"><BookOpen className="w-6 h-6 text-mk-accent" /> Research</h1>
        <p className="text-sm text-mk-muted mt-1">
          What REX found on the live web about {product.name}. Every claim links to its source; anything marked
          <span className="text-mk-warn"> unverified</span> is the agent’s inference, not a found fact.
        </p>
      </div>

      <Section icon={Target} title="The product">
        <p className="text-sm text-mk-body">{r.product.what_it_does}</p>
        <p className="text-sm text-mk-muted mt-1">For: {r.product.who_its_for}</p>
        {r.product.key_features.length > 0 && (
          <ul className="mt-3 grid sm:grid-cols-2 gap-1.5">
            {r.product.key_features.map((f, i) => <li key={i} className="text-sm text-mk-body">• {f}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-6 mt-4 text-xs text-mk-muted">
          <span>Pricing: <span className="text-mk-body">{r.product.pricing ?? 'not stated on the site'}</span></span>
          {r.product.proof_points.length > 0 && <span>Proof: <span className="text-mk-body">{r.product.proof_points.join(' · ')}</span></span>}
        </div>
      </Section>

      <Section icon={Swords} title={`Competitors (${r.competitors.length})`}>
        <div className="space-y-3">
          {r.competitors.map((c, i) => (
            <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-4">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="font-medium text-mk-text">{c.name}</p>
                {c.pricing && <span className="text-xs text-mk-ok">{c.pricing}</span>}
                <Cite url={c.source} />
              </div>
              <p className="text-sm text-mk-body mt-1">{c.positioning}</p>
              <div className="grid sm:grid-cols-2 gap-3 mt-2 text-xs">
                <div><span className="text-mk-ok">Strong:</span> <span className="text-mk-muted">{c.strengths.join('; ') || '—'}</span></div>
                <div><span className="text-mk-bad">Weak:</span> <span className="text-mk-muted">{c.weaknesses.join('; ') || '—'}</span></div>
              </div>
            </div>
          ))}
        </div>
        {r.positioning_gaps.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-mk-muted uppercase tracking-wider mb-2">Openings they leave</p>
            <ul className="space-y-1">{r.positioning_gaps.map((g, i) => <li key={i} className="text-sm text-mk-body">• {g}</li>)}</ul>
          </div>
        )}
      </Section>

      <Section icon={Users} title="Your audience">
        <p className="text-xs text-mk-muted uppercase tracking-wider mb-2">What they struggle with</p>
        <ul className="space-y-1.5">
          {r.audience.pain_points.map((p, i) => <li key={i} className="text-sm text-mk-body">• {p.point}<Cite url={p.source} /></li>)}
        </ul>
        {r.audience.language_they_use.length > 0 && (
          <>
            <p className="text-xs text-mk-muted uppercase tracking-wider mt-4 mb-2">In their words</p>
            <div className="flex flex-wrap gap-2">
              {r.audience.language_they_use.map((q, i) => <span key={i} className="text-xs text-mk-body bg-mk-bg border border-mk-line rounded-full px-3 py-1">“{q}”</span>)}
            </div>
          </>
        )}
        <p className="text-xs text-mk-muted uppercase tracking-wider mt-4 mb-2">Where they gather</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {r.audience.where_they_gather.map((w, i) => (
            <div key={i} className="bg-mk-bg border border-mk-line rounded-xl p-3">
              <p className="text-sm text-mk-text">
                {w.url ? <a href={w.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{w.name}</a> : w.name}
                <span className="text-xs text-mk-muted"> · {w.platform}</span>
                <Cite url={w.source} />
              </p>
              <p className="text-xs text-mk-muted mt-1">{w.why}</p>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid md:grid-cols-2 gap-5">
        <Section icon={MessageCircleQuestion} title="Questions people ask">
          <ul className="space-y-1.5">
            {r.questions_people_ask.map((q, i) => <li key={i} className="text-sm text-mk-body">• {q.question}<Cite url={q.source} /></li>)}
          </ul>
        </Section>
        <Section icon={Target} title={`Market · ${r.market.category}`}>
          <p className="text-sm text-mk-body">{r.market.summary}</p>
          <ul className="space-y-1.5 mt-3">
            {r.market.trends.map((t, i) => <li key={i} className="text-sm text-mk-body">• {t.point}<Cite url={t.source} /></li>)}
          </ul>
        </Section>
      </div>

      {r.unknowns.length > 0 && (
        <Section icon={HelpCircle} title="Couldn’t confirm">
          <p className="text-xs text-mk-muted mb-2">REX looked but found no reliable source for these, so no agent will state them as fact.</p>
          <ul className="space-y-1">{r.unknowns.map((u, i) => <li key={i} className="text-sm text-mk-muted">• {u}</li>)}</ul>
        </Section>
      )}

      <Section icon={ExternalLink} title={`All sources (${sources?.length ?? 0})`}>
        <ul className="space-y-1.5">
          {(sources ?? []).map(s => (
            <li key={s.url} className="text-sm">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-mk-accent-soft hover:underline break-all">{s.title || s.url}</a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
