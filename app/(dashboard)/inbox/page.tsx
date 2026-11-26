import { CheckCircle2, CircleHelp, ClipboardCheck, Database, FileText, Mail, Megaphone, Send, Bug, ListTodo, Target, UserCheck } from 'lucide-react'
import { PageHeader, tone } from '@/components/engine/ui'
import { GoToProduct } from '@/components/execs/go-to-product'
import { inboxItems, type InboxItem } from '@/lib/engine/execs/inbox'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const ICON: Record<InboxItem['kind'], typeof Send> = {
  goals: Target, setup: Database, decision: CircleHelp, todo: ListTodo, profile: UserCheck, strategy: ClipboardCheck, bug: Bug,
  pitches: Send, customer_emails: Mail, posts: FileText, outreach: Megaphone,
}

// Everything waiting for you, across every product, most important first.
export default async function InboxPage() {
  const items = await inboxItems()
  return (
    <div className="p-8 max-w-3xl space-y-4">
      <PageHeader icon={ClipboardCheck} title="Inbox" subtitle="Everything waiting for you, across every product — most important first." />
      {items.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 className="w-12 h-12 text-mk-ok mx-auto" />
          <p className="text-lg text-mk-text mt-3 font-medium">You’re all caught up</p>
          <p className={tone.muted}>The team will put things here when they need you.</p>
        </div>
      ) : items.map(i => {
        const Icon = ICON[i.kind]
        const body = (
          <div className="flex items-center gap-4 bg-mk-card border border-mk-line rounded-2xl px-5 py-4 hover:border-mk-accent/40 transition-colors text-left w-full">
            <div className="w-10 h-10 rounded-xl bg-mk-accent/10 flex items-center justify-center shrink-0"><Icon className="w-5 h-5 text-mk-accent" /></div>
            <div className="flex-1 min-w-0">
              <p className="text-mk-text font-medium">{i.title}</p>
              <p className="text-sm text-mk-muted">{i.product ? <span className="text-mk-accent-soft">{i.product.name} · </span> : null}{i.detail}</p>
            </div>
            <span className="text-sm text-mk-accent whitespace-nowrap">Open →</span>
          </div>
        )
        return i.product
          ? <GoToProduct key={i.key} productId={i.product.id} href={i.href} className="block w-full">{body}</GoToProduct>
          : <Link key={i.key} href={i.href} className="block">{body}</Link>
      })}
    </div>
  )
}
