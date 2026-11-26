import Link from 'next/link'
import { AlertCircle, ExternalLink } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Shared building blocks for MarkOS pages, in the app's existing dark palette.

export const tone = {
  card: 'bg-mk-card border border-mk-line rounded-2xl',
  inset: 'bg-mk-bg border border-mk-line rounded-xl',
  label: 'text-xs text-mk-muted uppercase tracking-wider',
  body: 'text-sm text-mk-body leading-relaxed',
  muted: 'text-xs text-mk-muted',
  input: 'w-full bg-mk-bg border border-mk-line rounded-lg px-3 py-2 text-sm text-mk-text focus:outline-none focus:border-mk-accent',
  primaryBtn: 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-mk-accent text-white hover:bg-mk-accent-strong disabled:opacity-50',
  ghostBtn: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-mk-muted hover:text-mk-text hover:bg-mk-line disabled:opacity-50',
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(tone.card, 'p-5', className)}>{children}</div>
}

export function SectionTitle({ icon: Icon, children, right }: { icon?: LucideIcon; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {Icon && <Icon className="w-4 h-4 text-mk-accent" />}
      <h2 className="font-semibold text-mk-text flex-1">{children}</h2>
      {right}
    </div>
  )
}

export function PageHeader({ icon: Icon, title, subtitle, actions }: {
  icon: LucideIcon; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-mk-text flex items-center gap-3">
          <Icon className="w-6 h-6 text-mk-accent" /> {title}
        </h1>
        {subtitle && <div className="text-sm text-mk-muted mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="bg-mk-card border border-dashed border-mk-line rounded-2xl p-12 text-center">
      <Icon className="w-10 h-10 text-mk-faint mx-auto mb-3" />
      <p className="text-mk-body font-medium">{title}</p>
      {children && <div className="text-sm text-mk-muted mt-1">{children}</div>}
    </div>
  )
}

/** A citation: a real, clickable page — or an honest "unverified". */
export function Cite({ url, className }: { url: string | null | undefined; className?: string }) {
  if (!url) {
    return (
      <span title="No web source backs this — treat it as the agent's inference"
        className={cn('inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-mk-warn/80 ml-2', className)}>
        <AlertCircle className="w-3 h-3" /> unverified
      </span>
    )
  }
  let host = url
  try { host = new URL(url).host.replace(/^www\./, '') } catch {}
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className={cn('inline-flex items-center gap-1 text-[11px] text-mk-accent hover:underline ml-2 whitespace-nowrap', className)}>
      {host} <ExternalLink className="w-3 h-3" />
    </a>
  )
}

export function Pill({ children, color = 'default' }: { children: React.ReactNode; color?: 'default' | 'green' | 'amber' | 'red' | 'violet' }) {
  const colors = {
    default: 'bg-mk-line text-mk-muted',
    green: 'bg-mk-ok/15 text-mk-ok',
    amber: 'bg-mk-warn/15 text-mk-warn',
    red: 'bg-mk-bad/15 text-mk-bad',
    violet: 'bg-mk-accent/20 text-mk-accent-soft',
  }
  return <span className={cn('inline-flex items-center text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full', colors[color])}>{children}</span>
}

/** Shown on pages whose agent needs an approved strategy first. */
export function NeedsStrategy() {
  return (
    <div className="bg-mk-warn/10 border border-mk-warn/30 rounded-2xl px-5 py-4 text-sm text-mk-body">
      Every agent writes from your approved strategy.{' '}
      <Link href="/strategy" className="text-mk-warn hover:underline">Review and approve it first →</Link>
    </div>
  )
}

export function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}
