'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Home, MessagesSquare, Inbox, CalendarDays, Briefcase, GraduationCap, Settings, Zap, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Five places, each answering one question:
//   Home      — who's on my team and what are they doing?
//   Goals     — what are we all working toward?
//   Team room — what are they saying to each other (and to me)?
//   Inbox     — what's waiting for me?
//   Calendar  — when am I meeting whom?
//   Products  — everything about one product, in tabs.
// Plus the roles and settings at the bottom.

const MAIN: Array<{ href: string; label: string; icon: LucideIcon; match: string[]; badge?: 'inbox' | 'today' }> = [
  { href: '/brief', label: 'Home', icon: Home, match: ['/brief', '/agent'] },
  { href: '/goals', label: 'Goals', icon: Target, match: ['/goals'] },
  { href: '/room', label: 'Team room', icon: MessagesSquare, match: ['/room'] },
  { href: '/inbox', label: 'Inbox', icon: Inbox, match: ['/inbox', '/approvals'], badge: 'inbox' },
  { href: '/meetings', label: 'Calendar', icon: CalendarDays, match: ['/meetings'], badge: 'today' },
  { href: '/portfolio', label: 'Products', icon: Briefcase,
    match: ['/portfolio', '/products', '/research', '/strategy', '/review', '/content', '/distribution', '/search', '/creative', '/pipeline', '/customers', '/quality', '/pr', '/ads', '/investor'] },
]
const FOOT = [
  { href: '/team', label: 'Team & roles', icon: GraduationCap },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ inbox = 0, meetingsToday = 0 }: { inbox?: number; meetingsToday?: number }) {
  const pathname = usePathname()
  const on = (paths: string[]) => paths.some(p => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-mk-card border-r border-mk-line flex flex-col z-40">
      <Link href="/brief" className="flex items-center gap-2 px-5 py-5">
        <div className="w-8 h-8 rounded-xl bg-mk-accent flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-mk-text text-lg">MarkOS</span>
      </Link>

      <nav className="flex-1 px-3 space-y-1">
        {MAIN.map(({ href, label, icon: Icon, match, badge }) => {
          const count = badge === 'inbox' ? inbox : badge === 'today' ? meetingsToday : 0
          return (
            <Link key={href} href={href}
              className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl text-[15px] font-medium transition-colors',
                on(match) ? 'bg-mk-accent/10 text-mk-accent' : 'text-mk-body hover:bg-mk-bg hover:text-mk-text')}>
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              {label}
              {count > 0 && (
                <span className={cn('ml-auto text-xs rounded-full px-2 py-0.5 min-w-[22px] text-center',
                  badge === 'inbox' ? 'bg-mk-accent text-white' : 'bg-mk-line text-mk-body')}>{count}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-mk-line space-y-1">
        {FOOT.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn('flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors',
              on([href]) ? 'bg-mk-accent/10 text-mk-accent' : 'text-mk-muted hover:bg-mk-bg hover:text-mk-text')}>
            <Icon className="w-4 h-4" /> {label}
          </Link>
        ))}
      </div>
    </aside>
  )
}
